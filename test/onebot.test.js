import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { OneBotClient } from "../lib/onebot.js";

class FakeSocket extends EventEmitter {
  static OPEN = 1;
  static instances = [];

  constructor(url, options) {
    super();
    this.url = url;
    this.options = options;
    this.readyState = FakeSocket.OPEN;
    this.sent = [];
    FakeSocket.instances.push(this);
  }

  send(value) { this.sent.push(value); }
  close() { this.readyState = 3; this.emit("close"); }
}

test("OneBotClient routes events and correlates send_private_msg responses", async () => {
  FakeSocket.instances.length = 0;
  const events = [];
  const client = new OneBotClient({
    url: "ws://127.0.0.1:3001",
    token: "secret",
    reconnectMs: 60_000,
    actionTimeoutMs: 1_000,
    WebSocketClass: FakeSocket,
    onEvent: async (event) => { events.push(event); },
  });
  client.start();
  const socket = FakeSocket.instances[0];
  socket.emit("open");

  socket.emit("message", Buffer.from(JSON.stringify({ post_type: "message", message_id: 8 })));
  const responsePromise = client.sendPrivateMessage("10001", "完成");
  const request = JSON.parse(socket.sent[0]);
  assert.equal(request.action, "send_private_msg");
  assert.deepEqual(request.params, { user_id: "10001", message: "完成" });
  socket.emit("message", Buffer.from(JSON.stringify({ status: "ok", retcode: 0, echo: request.echo, data: { message_id: 9 } })));

  assert.deepEqual(await responsePromise, { message_id: 9 });
  assert.deepEqual(events, [{ post_type: "message", message_id: 8 }]);
  assert.equal(socket.options.headers.Authorization, "Bearer secret");
  assert.equal(client.connected, true);
  await client.stop();
});

test("OneBotClient resolves image metadata through get_image", async () => {
  FakeSocket.instances.length = 0;
  const client = new OneBotClient({
    url: "ws://127.0.0.1:3001",
    reconnectMs: 60_000,
    actionTimeoutMs: 1_000,
    WebSocketClass: FakeSocket,
  });
  client.start();
  const socket = FakeSocket.instances[0];
  socket.emit("open");

  const resultPromise = client.resolveAttachment({ type: "image", file: "cache-image.jpg" }, "10001");
  const request = JSON.parse(socket.sent[0]);
  assert.equal(request.action, "get_image");
  assert.deepEqual(request.params, { file: "cache-image.jpg" });
  socket.emit("message", Buffer.from(JSON.stringify({
    status: "ok",
    retcode: 0,
    echo: request.echo,
    data: {
      data: {
        file_path: "C:\\Users\\example\\Pictures\\image.jpg",
        file_size: 123,
        file_name: "image.jpg",
      },
      url: "https://files.test/image.jpg",
    },
  })));

  assert.deepEqual(await resultPromise, {
    type: "image",
    file: "C:\\Users\\example\\Pictures\\image.jpg",
    url: "https://files.test/image.jpg",
    name: "image.jpg",
    size: 123,
  });
  await client.stop();
});

test("OneBotClient preserves direct base64 attachments without an API lookup", async () => {
  FakeSocket.instances.length = 0;
  const client = new OneBotClient({
    url: "ws://127.0.0.1:3001",
    WebSocketClass: FakeSocket,
  });

  const attachment = {
    type: "image",
    base64: "data:image/png;base64,iVBORw0KGgo=",
    name: "inline.png",
  };
  assert.deepEqual(await client.resolveAttachment(attachment, "10001"), {
    ...attachment,
    url: attachment.base64,
  });
});
