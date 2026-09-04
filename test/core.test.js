import test from "node:test";
import assert from "node:assert/strict";

import {
  ContactQueue,
  RecentMessageIds,
  assistantReplyAfter,
  normalizePrivateMessage,
  parseAllowedContacts,
} from "../lib/core.js";

test("parseAllowedContacts normalizes a CSV string and an array", () => {
  assert.deepEqual([...parseAllowedContacts(" 10001,10002,10001 ")], ["10001", "10002"]);
  assert.deepEqual([...parseAllowedContacts([10003, " 10004 "])], ["10003", "10004"]);
});

test("normalizePrivateMessage accepts only allow-listed incoming private messages", () => {
  const allowed = new Set(["10001"]);
  const accepted = normalizePrivateMessage({
    post_type: "message",
    message_type: "private",
    self_id: 90000,
    user_id: 10001,
    message_id: 77,
    message: [
      { type: "text", data: { text: "整理 " } },
      { type: "image", data: { file: "pic.jpg" } },
      { type: "text", data: { text: "资料" } },
    ],
  }, allowed);

  assert.equal(accepted.senderId, "10001");
  assert.equal(accepted.messageId, "77");
  assert.equal(accepted.text, "整理 [图片]资料");
  assert.deepEqual(accepted.parts, [
    { type: "text", text: "整理 " },
    { type: "image", attachment: { file: "pic.jpg" }, text: "[图片]" },
    { type: "text", text: "资料" },
  ]);
  assert.deepEqual(accepted.attachments, [{ type: "image", file: "pic.jpg" }]);
  assert.equal(normalizePrivateMessage({ ...accepted, post_type: "message", message_type: "group", user_id: 10001 }, allowed), null);
  assert.equal(normalizePrivateMessage({ post_type: "message", message_type: "private", user_id: 10002, raw_message: "忽略" }, allowed), null);
  assert.equal(normalizePrivateMessage({ post_type: "message_sent", message_type: "private", user_id: 10001, raw_message: "忽略自己" }, allowed), null);
});

test("normalizePrivateMessage accepts a private offline_file notice", () => {
  const message = normalizePrivateMessage({
    post_type: "notice",
    notice_type: "offline_file",
    user_id: 10001,
    time: 123,
    file: { file_id: "f-1", name: "资料.txt", size: 12, url: "https://files.test/1" },
  }, new Set(["10001"]));

  assert.equal(message.text, "[文件: 资料.txt]");
  assert.deepEqual(message.attachments, [{
    type: "file",
    fileId: "f-1",
    name: "资料.txt",
    size: 12,
    url: "https://files.test/1",
  }]);
});

test("normalizePrivateMessage preserves native QQ face and market-face metadata", () => {
  const message = normalizePrivateMessage({
    post_type: "message",
    message_type: "private",
    self_id: 90000,
    user_id: 10001,
    message_id: 78,
    message: [
      { type: "face", data: { id: "14" } },
      { type: "mface", data: {
        emoji_id: "27",
        emoji_package_id: "14",
        key: "asset-key",
        summary: "笑",
      } },
    ],
  }, new Set(["10001"]));

  assert.equal(message.selfId, "90000");
  assert.deepEqual(message.parts, [
    { type: "face", faceId: "14", text: "[表情:14]" },
    {
      type: "mface",
      attachment: {
        emojiId: "27",
        emojiPackageId: "14",
        emojiKey: "asset-key",
        emojiSummary: "笑",
      },
      text: "[QQ 商城表情: 笑]",
    },
  ]);
  assert.deepEqual(message.attachments, []);
});

test("RecentMessageIds rejects duplicates and evicts the oldest id", () => {
  const recent = new RecentMessageIds(2);
  assert.equal(recent.accept("a"), true);
  assert.equal(recent.accept("a"), false);
  assert.equal(recent.accept("b"), true);
  assert.equal(recent.accept("c"), true);
  assert.equal(recent.accept("a"), true);
});

test("assistantReplyAfter returns only new visible assistant text", () => {
  const before = [
    { role: "assistant", content: [{ type: "text", text: "旧回复" }] },
  ];
  const after = [
    ...before,
    { role: "user", content: [{ type: "text", text: "新任务" }] },
    { role: "assistant", content: [
      { type: "reasoning", text: "隐藏思考" },
      { type: "text", text: "已完成" },
      { type: "text", text: "，结果在工作区。" },
    ] },
  ];
  assert.equal(assistantReplyAfter(after, before.length), "已完成，结果在工作区。");
  assert.equal(assistantReplyAfter(before, before.length), "");
});

test("ContactQueue serializes one contact while allowing different contacts to overlap", async () => {
  const queue = new ContactQueue();
  const events = [];
  let releaseA;
  const gateA = new Promise((resolve) => { releaseA = resolve; });

  const a1 = queue.run("A", async () => {
    events.push("a1:start");
    await gateA;
    events.push("a1:end");
  });
  const a2 = queue.run("A", async () => { events.push("a2"); });
  const b1 = queue.run("B", async () => { events.push("b1"); });

  await b1;
  assert.deepEqual(events, ["a1:start", "b1"]);
  releaseA();
  await Promise.all([a1, a2]);
  assert.deepEqual(events, ["a1:start", "b1", "a1:end", "a2"]);
});
