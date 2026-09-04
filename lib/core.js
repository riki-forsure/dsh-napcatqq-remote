export function parseAllowedContacts(value) {
  const items = Array.isArray(value) ? value : String(value ?? "").split(",");
  return new Set(items.map((item) => String(item).trim()).filter(Boolean));
}

function stringValue(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function attachmentData(segment) {
  const data = segment?.data && typeof segment.data === "object" ? segment.data : segment;
  if (!data || typeof data !== "object") return {};
  const fileId = stringValue(data.file_id ?? data.fileId ?? data.id);
  const file = stringValue(data.file ?? data.file_path ?? data.filePath ?? data.local_path ?? data.localPath ?? data.path);
  const url = stringValue(data.url ?? data.download_url ?? data.downloadUrl);
  const base64 = stringValue(data.base64 ?? (typeof data.data === "string" ? data.data : ""));
  const name = stringValue(data.name ?? data.file_name ?? data.fileName);
  const sizeValue = Number(data.file_size ?? data.size ?? data.fileSize);
  const emojiId = stringValue(data.emoji_id ?? data.emojiId);
  const emojiPackageId = stringValue(data.emoji_package_id ?? data.emojiPackageId);
  const emojiKey = stringValue(data.key ?? data.emoji_key ?? data.emojiKey);
  const emojiSummary = stringValue(data.summary ?? data.face_name ?? data.faceName);
  return {
    ...(file ? { file } : {}),
    ...(fileId ? { fileId } : {}),
    ...(url ? { url } : {}),
    ...(base64 ? { base64 } : {}),
    ...(name ? { name } : {}),
    ...(Number.isSafeInteger(sizeValue) && sizeValue >= 0 ? { size: sizeValue } : {}),
    ...(stringValue(data.mime_type ?? data.mimeType ?? data.content_type)
      ? { mediaType: stringValue(data.mime_type ?? data.mimeType ?? data.content_type).toLowerCase() }
      : {}),
    ...(emojiId ? { emojiId } : {}),
    ...(emojiPackageId ? { emojiPackageId } : {}),
    ...(emojiKey ? { emojiKey } : {}),
    ...(emojiSummary ? { emojiSummary } : {}),
  };
}

function hasImageReference(attachment) {
  return [attachment?.url, attachment?.file, attachment?.base64]
    .some((value) => stringValue(value));
}

function faceIdFrom(segment) {
  const data = segment?.data && typeof segment.data === "object" ? segment.data : segment;
  return stringValue(data?.id ?? data?.face_id ?? data?.faceId);
}

function faceLabel(attachment, fallback = "QQ 表情") {
  const summary = attachment?.emojiSummary;
  if (summary) return `[${fallback}: ${summary}]`;
  const id = attachment?.faceId || attachment?.emojiId;
  return id ? `[${fallback}: ${id}]` : `[${fallback}]`;
}

function segmentPart(segment) {
  if (!segment || typeof segment !== "object") return null;
  const type = stringValue(segment.type).toLowerCase();
  if (type === "text") return { type: "text", text: String(segment.data?.text ?? "") };
  if (type === "image") {
    const attachment = attachmentData(segment);
    return {
      type: "image",
      attachment,
      text: attachment.emojiId || attachment.emojiPackageId
        ? faceLabel(attachment)
        : `[图片${attachment.name ? `: ${attachment.name}` : ""}]`,
    };
  }
  if (type === "file") {
    const attachment = attachmentData(segment);
    const label = attachment.name || attachment.file || "附件";
    return { type: "file", attachment, text: `[文件: ${label}]` };
  }
  if (type === "record") return { type: "text", text: "[语音]" };
  if (type === "video") return { type: "text", text: "[视频]" };
  if (type === "face") {
    const faceId = faceIdFrom(segment);
    const attachment = { ...attachmentData(segment), ...(faceId ? { faceId } : {}) };
    if (faceId && !hasImageReference(attachment)) delete attachment.fileId;
    if (hasImageReference(attachment)) {
      return { type: "image", attachment, text: faceLabel(attachment) };
    }
    return { type: "face", faceId, text: `[表情:${faceId}]` };
  }
  if (["mface", "marketface", "market_face"].includes(type)) {
    const attachment = attachmentData(segment);
    const text = faceLabel(attachment, "QQ 商城表情");
    return hasImageReference(attachment)
      ? { type: "image", attachment, text }
      : { type: "mface", attachment, text };
  }
  return null;
}

function eventParts(event) {
  if (Array.isArray(event.message)) {
    return event.message.map(segmentPart).filter(Boolean);
  }
  if (typeof event.message === "string" && event.message.trim()) {
    return parseCqMessage(event.message);
  }
  if (event.notice_type === "offline_file" && event.file !== undefined) {
    const part = segmentPart({ type: "file", data: event.file });
    return part ? [part] : [];
  }
  if (typeof event.raw_message === "string" && event.raw_message.trim()) {
    return parseCqMessage(event.raw_message);
  }
  return [];
}

function parseCqMessage(value) {
  const source = String(value);
  const parts = [];
  let cursor = 0;
  const pattern = /\[CQ:([a-zA-Z0-9_-]+)((?:,[^\]]*)?)\]/g;
  for (const match of source.matchAll(pattern)) {
    if (match.index > cursor) parts.push({ type: "text", text: source.slice(cursor, match.index) });
    const type = match[1].toLowerCase();
    const data = {};
    for (const field of String(match[2] ?? "").split(",").slice(1)) {
      const separator = field.indexOf("=");
      if (separator < 1) continue;
      data[field.slice(0, separator)] = decodeCqValue(field.slice(separator + 1));
    }
    const part = segmentPart({ type, data });
    parts.push(part ?? { type: "text", text: match[0] });
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) parts.push({ type: "text", text: source.slice(cursor) });
  return parts.length > 0 ? parts : [{ type: "text", text: source }];
}

function decodeCqValue(value) {
  return String(value)
    .replaceAll("&#44;", ",")
    .replaceAll("&#91;", "[")
    .replaceAll("&#93;", "]")
    .replaceAll("&amp;", "&");
}

function eventText(parts) {
  return parts.map((part) => part.text ?? "").join("").trim();
}

function isPrivateIncomingEvent(event) {
  if (!event) return false;
  if (event.post_type === "message") return event.message_type === "private";
  return event.post_type === "notice" && event.notice_type === "offline_file";
}

export function normalizePrivateMessage(event, allowedContacts) {
  if (!isPrivateIncomingEvent(event)) return null;
  const senderId = String(event.user_id ?? "");
  if (!senderId || !allowedContacts.has(senderId)) return null;
  const parts = eventParts(event);
  const text = eventText(parts);
  if (!text) return null;
  const attachments = parts
    .filter((part) => part.type === "image" || part.type === "file")
    .map((part) => ({ type: part.type, ...part.attachment }));
  return {
    senderId,
    ...(stringValue(event.self_id) ? { selfId: stringValue(event.self_id) } : {}),
    messageId: String(
      event.message_id
        ?? event.message_id_str
        ?? `${senderId}:${event.notice_type ?? "message"}:${event.time ?? Date.now()}:${attachments.map((item) => item.fileId ?? item.file ?? item.name ?? item.type).join(",")}`,
    ),
    text,
    parts,
    attachments,
  };
}

export class RecentMessageIds {
  constructor(limit = 1024) {
    this.limit = Math.max(1, limit);
    this.ids = new Set();
  }

  accept(id) {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    while (this.ids.size > this.limit) this.ids.delete(this.ids.values().next().value);
    return true;
  }
}

export function assistantReplyAfter(messages, startIndex) {
  const fresh = messages.slice(startIndex);
  for (let index = fresh.length - 1; index >= 0; index -= 1) {
    const message = fresh[index];
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    return message.content
      .filter((block) => block?.type === "text")
      .map((block) => String(block.text ?? ""))
      .join("")
      .trim();
  }
  return "";
}

export class ContactQueue {
  constructor() {
    this.tails = new Map();
  }

  run(contactId, task) {
    const previous = this.tails.get(contactId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.tails.set(contactId, current);
    void current.finally(() => {
      if (this.tails.get(contactId) === current) this.tails.delete(contactId);
    }).catch(() => undefined);
    return current;
  }
}
