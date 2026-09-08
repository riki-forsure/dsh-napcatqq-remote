import {
  RecentMessageIds,
  normalizePrivateMessage,
  parseAllowedContacts,
} from "./core.js";

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export class QqChannel {
  constructor(options) {
    this.allowedContacts = parseAllowedContacts(options.allowedContacts);
    this.dispatchTask = options.dispatchTask;
    this.resolveAttachment = options.resolveAttachment;
    this.sendPrivateMessage = options.sendPrivateMessage;
    this.resetSession = options.resetSession ?? (async () => undefined);
    this.listHistory = options.listHistory ?? (async () => "当前联系人还没有可切换的 QQ 历史对话。");
    this.switchSession = options.switchSession ?? (async () => "用法：/切换 序号；请先发送 /历史 查看可用序号。");
    this.statusText = options.statusText ?? (() => "QQ 渠道在线");
    this.log = options.log ?? { info() {}, warn() {}, error() {} };
    this.recent = new RecentMessageIds(options.dedupeLimit ?? 2048);
    this.sendTails = new Map();
  }

  accept(event) {
    const message = normalizePrivateMessage(event, this.allowedContacts);
    if (!message) {
      if (event?.post_type === "message" && event?.message_type === "private" && event?.user_id !== undefined) {
        this.log.info?.(`ignored QQ private message from ${String(event.user_id)}; allowed contacts: ${[...this.allowedContacts].join(",") || "(empty)"}`);
      }
      return Promise.resolve(false);
    }
    const dedupeKey = `${message.senderId}:${message.messageId}`;
    if (!this.recent.accept(dedupeKey)) return Promise.resolve(false);
    return this.process(message);
  }

  async process(message) {
      try {
        if (message.text === "/状态" || message.text === "/status") {
          await this.send(message.senderId, this.statusText());
          return true;
        }
        if (message.text === "/新任务" || message.text === "/new") {
          await this.resetSession(message.senderId);
          await this.send(
            message.senderId,
            "已新建独立 dsh 会话，下一条消息将作为新任务开始。",
          );
          return true;
        }
        if (message.text === "/历史" || message.text.toLowerCase() === "/history") {
          await this.send(message.senderId, await this.listHistory(message.senderId));
          return true;
        }
        const switchCommand = message.text.match(/^\/(?:切换|switch)(?:\s+(.*))?$/i);
        if (switchCommand) {
          await this.send(
            message.senderId,
            await this.switchSession(message.senderId, String(switchCommand[1] ?? "").trim()),
          );
          return true;
        }
        this.log.info?.(`accepted QQ task from ${message.senderId}`);
        const enriched = await this.prepareMessage(message);
        const reply = await this.dispatchTask(message.senderId, enriched.text, enriched);
        await this.send(
          message.senderId,
          reply || "dsh 已完成本轮处理，详情可在 QQ 渠道工作区查看。",
        );
        return true;
      } catch (error) {
        this.log.error?.(`QQ task failed for ${message.senderId}: ${errorMessage(error)}`);
        await this.send(message.senderId, `dsh 处理失败：${errorMessage(error)}`);
        return false;
      }
  }

  async send(senderId, message) {
    const key = String(senderId);
    const previous = this.sendTails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => this.sendPrivateMessage(key, message));
    this.sendTails.set(key, current);
    try {
      return await current;
    } finally {
      if (this.sendTails.get(key) === current) this.sendTails.delete(key);
    }
  }

  async prepareMessage(message) {
    if (!message.attachments?.length || typeof this.resolveAttachment !== "function") return message;
    const resolved = [];
    for (const attachment of message.attachments) {
      try {
        resolved.push(await this.resolveAttachment(attachment, message.senderId));
      } catch (error) {
        this.log.warn?.(`QQ attachment lookup failed for ${message.senderId}: ${errorMessage(error)}`);
        resolved.push({ ...attachment, error: errorMessage(error) });
      }
    }
    let attachmentIndex = 0;
    const parts = message.parts.map((part) => {
      if (part.type !== "image" && part.type !== "file") return part;
      const attachment = resolved[attachmentIndex++] ?? part.attachment;
      return { ...part, attachment };
    });
    return { ...message, parts, attachments: resolved };
  }
}
