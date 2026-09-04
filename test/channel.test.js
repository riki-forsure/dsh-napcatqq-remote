import test from "node:test";
import assert from "node:assert/strict";

import { QqChannel } from "../lib/channel.js";

function privateMessage(messageId, text, userId = 10001) {
  return {
    post_type: "message",
    message_type: "private",
    message_id: messageId,
    user_id: userId,
    raw_message: text,
  };
}

test("QqChannel dispatches one allow-listed message and sends the result", async () => {
  const sent = [];
  const work = [];
  const channel = new QqChannel({
    allowedContacts: ["10001"],
    dispatchTask: async (senderId, text) => {
      work.push([senderId, text]);
      return "完成";
    },
    sendPrivateMessage: async (senderId, text) => { sent.push([senderId, text]); },
  });

  await channel.accept(privateMessage(1, "整理项目"));
  await channel.accept(privateMessage(1, "整理项目"));
  await channel.accept(privateMessage(2, "忽略", 10002));

  assert.deepEqual(work, [["10001", "整理项目"]]);
  assert.deepEqual(sent, [["10001", "完成"]]);
});

test("QqChannel dispatches multiple allow-listed contacts in parallel", async () => {
  const work = [];
  let active = 0;
  let peak = 0;
  const channel = new QqChannel({
    allowedContacts: ["10001", "10002"],
    dispatchTask: async (senderId, text) => {
      active += 1;
      peak = Math.max(peak, active);
      work.push([senderId, text]);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return `完成-${senderId}`;
    },
    sendPrivateMessage: async () => undefined,
  });

  await Promise.all([
    channel.accept(privateMessage(101, "甲的任务", 10001)),
    channel.accept(privateMessage(102, "乙的任务", 10002)),
  ]);

  assert.equal(peak, 2);
  assert.deepEqual(work, [
    ["10001", "甲的任务"],
    ["10002", "乙的任务"],
  ]);
});

test("QqChannel reports task failures back to the originating contact", async () => {
  const sent = [];
  const channel = new QqChannel({
    allowedContacts: ["10001"],
    dispatchTask: async () => { throw new Error("模型连接中断"); },
    sendPrivateMessage: async (senderId, text) => { sent.push([senderId, text]); },
  });

  await channel.accept(privateMessage(3, "继续处理"));
  assert.deepEqual(sent, [["10001", "dsh 处理失败：模型连接中断"]]);
});

test("QqChannel handles its status and new-session commands locally", async () => {
  const sent = [];
  let resets = 0;
  const channel = new QqChannel({
    allowedContacts: ["10001"],
    dispatchTask: async () => "不应调用",
    resetSession: async () => { resets += 1; },
    statusText: () => "QQ 渠道在线",
    sendPrivateMessage: async (senderId, text) => { sent.push([senderId, text]); },
  });

  await channel.accept(privateMessage(4, "/状态"));
  await channel.accept(privateMessage(5, "/新任务"));

  assert.equal(resets, 1);
  assert.deepEqual(sent, [
    ["10001", "QQ 渠道在线"],
    ["10001", "已新建独立 dsh 会话，下一条消息将作为新任务开始。"],
  ]);
});

test("QqChannel accepts a second message while the first task is still running", async () => {
  const sent = [];
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  let release;
  const firstTask = new Promise((resolve) => { release = resolve; });
  const channel = new QqChannel({
    allowedContacts: ["10001"],
    dispatchTask: async (_senderId, text) => {
      if (text === "长任务") {
        markStarted();
        await firstTask;
        return "长任务完成";
      }
      return "已把这条消息插入当前任务，当前任务完成后会继续回复。";
    },
    sendPrivateMessage: async (senderId, text) => { sent.push([senderId, text]); },
  });

  const first = channel.accept(privateMessage(10, "长任务"));
  await started;
  const second = channel.accept(privateMessage(11, "补充要求"));
  await second;
  assert.deepEqual(sent, [["10001", "已把这条消息插入当前任务，当前任务完成后会继续回复。"]]);

  release();
  await first;
  assert.deepEqual(sent, [
    ["10001", "已把这条消息插入当前任务，当前任务完成后会继续回复。"],
    ["10001", "长任务完成"],
  ]);
});
