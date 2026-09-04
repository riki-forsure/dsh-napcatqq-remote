import { randomUUID } from "node:crypto";
import WebSocket from "ws";

function asErrorMessage(value) {
  return value instanceof Error ? value.message : String(value);
}

export class OneBotClient {
  constructor(options) {
    this.url = options.url;
    this.token = options.token ?? "";
    this.reconnectMs = options.reconnectMs ?? 5_000;
    this.actionTimeoutMs = options.actionTimeoutMs ?? 15_000;
    this.WebSocketClass = options.WebSocketClass ?? WebSocket;
    this.onEvent = options.onEvent;
    this.log = options.log ?? { info() {}, warn() {}, error() {} };
    this.socket = undefined;
    this.reconnectTimer = undefined;
    this.pending = new Map();
    this.stopped = true;
    this.connected = false;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  connect() {
    if (this.stopped) return;
    const options = this.token
      ? { headers: { Authorization: `Bearer ${this.token}` } }
      : { headers: {} };
    const socket = new this.WebSocketClass(this.url, options);
    this.socket = socket;
    socket.on("open", () => {
      if (this.socket !== socket) return;
      this.connected = true;
      this.log.info?.(`OneBot connected: ${this.url}`);
    });
    socket.on("message", (raw) => this.receive(raw));
    socket.on("error", (error) => {
      this.log.warn?.(`OneBot connection error: ${asErrorMessage(error)}`);
    });
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.connected = false;
      this.socket = undefined;
      this.rejectPending(new Error("OneBot connection closed"));
      this.scheduleReconnect();
    });
  }

  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, this.reconnectMs);
    this.reconnectTimer.unref?.();
  }

  receive(raw) {
    let payload;
    try {
      payload = JSON.parse(String(raw));
    } catch (error) {
      this.log.warn?.(`ignored invalid OneBot payload: ${asErrorMessage(error)}`);
      return;
    }
    if (payload && payload.echo !== undefined && this.pending.has(String(payload.echo))) {
      const pending = this.pending.get(String(payload.echo));
      this.pending.delete(String(payload.echo));
      clearTimeout(pending.timer);
      if (payload.status === "ok" && Number(payload.retcode ?? 0) === 0) pending.resolve(payload.data);
      else pending.reject(new Error(payload.message || payload.wording || `OneBot retcode ${payload.retcode}`));
      return;
    }
    Promise.resolve(this.onEvent?.(payload)).catch((error) => {
      this.log.error?.(`OneBot event handler failed: ${asErrorMessage(error)}`);
    });
  }

  call(action, params) {
    const socket = this.socket;
    if (!socket || !this.connected || socket.readyState !== this.WebSocketClass.OPEN) {
      return Promise.reject(new Error("OneBot 尚未连接"));
    }
    const echo = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo);
        reject(new Error(`OneBot 请求超时：${action}`));
      }, this.actionTimeoutMs);
      timer.unref?.();
      this.pending.set(echo, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ action, params, echo }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(echo);
        reject(error);
      }
    });
  }

  sendPrivateMessage(userId, message) {
    return this.call("send_private_msg", { user_id: String(userId), message });
  }

  /**
   * Resolve NapCat/OneBot attachment metadata without downloading it. NapCat
   * may put a URL directly on the segment, or only expose a cache name/file id
   * that must be resolved through the corresponding API action.
   */
  async resolveAttachment(attachment, userId) {
    const item = attachment && typeof attachment === "object" ? attachment : {};
    const directUrl = typeof item.url === "string" && item.url.trim() && isDirectReference(item.url)
      ? item.url.trim()
      : typeof item.file === "string" && /^(?:https?:|data:|file:|base64:)/i.test(item.file.trim())
        ? item.file.trim()
        : typeof item.base64 === "string" && /^(?:data:|base64:)/i.test(item.base64.trim())
          ? item.base64.trim()
          : typeof item.data === "string" && /^(?:data:|base64:)/i.test(item.data.trim())
            ? item.data.trim()
        : undefined;
    const fileId = typeof item.fileId === "string" && item.fileId.trim() ? item.fileId.trim() : undefined;
    const file = typeof item.file === "string" && item.file.trim() ? item.file.trim() : undefined;
    const resolved = {
      ...item,
      ...(directUrl ? { url: directUrl } : {}),
      ...(fileId ? { fileId } : {}),
      ...(file ? { file } : {}),
    };
    if (directUrl || (file && /^(?:[a-zA-Z]:[\\/]|[\\/]|file:|data:|base64:)/.test(file))) {
      return resolved;
    }

    const lookup = fileId || file || (!directUrl && typeof item.url === "string" && item.url.trim() ? item.url.trim() : undefined);
    if (!lookup) return resolved;
    if (item.type === "image") {
      const data = await this.call("get_image", { file: lookup });
      return { ...resolved, ...normalizeResolvedData(data) };
    }

    let data;
    try {
      data = await this.call("get_file", fileId ? { file_id: fileId } : { file: lookup });
    } catch (error) {
      // Some NapCat versions expose private-file URLs only through this
      // extension. Preserve the original get_file error when that fallback
      // cannot be used either.
      if (!fileId || !userId) throw error;
      data = {};
    }
    const merged = { ...resolved, ...normalizeResolvedData(data) };
    if (!merged.url && fileId && userId && !isLocalReference(merged.file)) {
      const privateData = await this.call("get_private_file_url", {
        user_id: String(userId),
        file_id: fileId,
      });
      Object.assign(merged, normalizeResolvedData(privateData));
    }
    return merged;
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async stop() {
    this.stopped = true;
    this.connected = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.rejectPending(new Error("OneBot client stopped"));
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState < 2) socket.close();
  }
}

function isLocalReference(value) {
  return typeof value === "string" && /^(?:[a-zA-Z]:[\\/]|[\\/]|file:)/.test(value.trim());
}

function isDirectReference(value) {
  return typeof value === "string" && /^(?:https?:|data:|file:|base64:|\/\/|[a-zA-Z]:[\\/])/i.test(value.trim());
}

function normalizeResolvedData(data) {
  if (!data || typeof data !== "object") return {};
  const nested = data.data && typeof data.data === "object" ? data.data : {};
  const merged = { ...data, ...nested };
  const file = typeof (merged.file ?? merged.file_path ?? merged.filePath ?? merged.local_path ?? merged.localPath ?? merged.path) === "string"
    && String(merged.file ?? merged.file_path ?? merged.filePath ?? merged.local_path ?? merged.localPath ?? merged.path).trim()
    ? String(merged.file ?? merged.file_path ?? merged.filePath ?? merged.local_path ?? merged.localPath ?? merged.path).trim()
    : undefined;
  const url = typeof merged.url === "string" && merged.url.trim() ? merged.url.trim() : undefined;
  const base64Value = merged.base64 ?? (typeof merged.data === "string" ? merged.data : undefined);
  const base64 = typeof base64Value === "string" && base64Value.trim() ? base64Value.trim() : undefined;
  const name = typeof (merged.name ?? merged.file_name ?? merged.fileName) === "string"
    ? String(merged.name ?? merged.file_name ?? merged.fileName).trim()
    : undefined;
  const size = Number(merged.file_size ?? merged.size ?? merged.fileSize);
  return {
    ...(file ? { file } : {}),
    ...(url ? { url } : {}),
    ...(base64 ? { base64 } : {}),
    ...(name ? { name } : {}),
    ...(Number.isSafeInteger(size) && size >= 0 ? { size } : {}),
  };
}
