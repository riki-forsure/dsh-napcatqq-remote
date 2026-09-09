import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import z from "@deepseek-ai/schemastery";

import { QqChannel } from "./channel.js";
import { DshTaskGateway, JsonStateStore } from "./dsh-gateway.js";
import { OneBotClient } from "./onebot.js";

export const name = "qq-channel";
export const inject = ["agents", "sessionPersistence", "workspaceRegistry", "agentPresets", "attachments"];

export function loadLocalOverrides(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object") return {};
    const overrides = {};
    if (Array.isArray(value.allowedContacts)) {
      overrides.allowedContacts = value.allowedContacts.map(String).map((item) => item.trim()).filter(Boolean);
    }
    if (typeof value.websocketUrl === "string" && value.websocketUrl.trim()) {
      overrides.websocketUrl = value.websocketUrl.trim();
    }
    if (typeof value.accessToken === "string") overrides.accessToken = value.accessToken;
    if (typeof value.stylePromptFile === "string") overrides.stylePromptFile = value.stylePromptFile.trim();
    if (typeof value.emojiRoot === "string") overrides.emojiRoot = value.emojiRoot.trim();
    if (typeof value.botSelfId === "string" || typeof value.botSelfId === "number") overrides.botSelfId = String(value.botSelfId).trim();
    if (typeof value.agentPreset === "string" && value.agentPreset.trim()) overrides.agentPreset = value.agentPreset.trim();
    if (Array.isArray(value.fallbackAgentPresets)) {
      overrides.fallbackAgentPresets = [...new Set(
        value.fallbackAgentPresets
          .filter((item) => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean),
      )];
    }
    if (typeof value.agentProvider === "string") overrides.agentProvider = value.agentProvider.trim();
    if (typeof value.agentModel === "string") overrides.agentModel = value.agentModel.trim();
    if (typeof value.agentReasoningEffort === "string") overrides.agentReasoningEffort = value.agentReasoningEffort.trim();
    for (const key of ["maxAttachmentBytes", "maxImageBytes", "filePreviewBytes"]) {
      if (Number.isSafeInteger(value[key]) && value[key] > 0) overrides[key] = value[key];
    }
    return overrides;
  } catch {
    return {};
  }
}

export const Config = z.object({
  enabled: z.boolean().default(true),
  websocketUrl: z.string().default("ws://127.0.0.1:3001"),
  accessToken: z.string().default(""),
  allowedContacts: z.array(z.string()).default([]),
  workspacePath: z.string().default(join(homedir(), "dsh-work", "qq-channel-workspace")),
  workspaceTitle: z.string().default("QQ 渠道"),
  agentPreset: z.string().default("router-standard"),
  fallbackAgentPresets: z.array(z.string()).default(["router-standard", "standard", "minimal"]),
  agentProvider: z.string().default("deepseek-official"),
  agentModel: z.string().default("deepseek-v4-flash-vision-exp"),
  agentReasoningEffort: z.string().default("max"),
  localConfigFile: z.string().default(join(homedir(), ".dsh", "qq-channel", "config.json")),
  stateFile: z.string().default(join(homedir(), ".dsh", "qq-channel", "state.json")),
  stylePromptFile: z.string().default(join(homedir(), ".dsh", "qq-channel", "contact-style.md")),
  emojiRoot: z.string().default(""),
  botSelfId: z.string().default(""),
  reconnectMs: z.natural().min(1_000).default(5_000),
  actionTimeoutMs: z.natural().min(1_000).default(15_000),
  maxAttachmentBytes: z.natural().min(1).default(50 * 1024 * 1024),
  maxImageBytes: z.natural().min(1).default(20 * 1024 * 1024),
  filePreviewBytes: z.natural().min(1).default(8 * 1024),
});

export function apply(ctx, config) {
  const log = ctx.logger("qq-channel");
  if (!config.enabled) {
    log.info("disabled by configuration");
    return;
  }

  const runtime = { ...config, ...loadLocalOverrides(config.localConfigFile) };
  if (process.env.DSH_QQ_CONTACTS?.trim()) {
    runtime.allowedContacts = process.env.DSH_QQ_CONTACTS.split(",").map((value) => value.trim()).filter(Boolean);
  }
  if (process.env.DSH_QQ_WS_URL?.trim()) runtime.websocketUrl = process.env.DSH_QQ_WS_URL.trim();
  if (process.env.DSH_QQ_TOKEN !== undefined) runtime.accessToken = process.env.DSH_QQ_TOKEN;
  if (process.env.DSH_QQ_AGENT_PRESET?.trim()) runtime.agentPreset = process.env.DSH_QQ_AGENT_PRESET.trim();
  if (process.env.DSH_QQ_FALLBACK_PRESETS !== undefined) {
    runtime.fallbackAgentPresets = [...new Set(
      process.env.DSH_QQ_FALLBACK_PRESETS.split(",").map((value) => value.trim()).filter(Boolean),
    )];
  }

  let stylePrompt = "";
  if (runtime.stylePromptFile) {
    try {
      stylePrompt = readFileSync(runtime.stylePromptFile, "utf8").trim();
    } catch (error) {
      log.warn(`QQ style prompt could not be loaded from ${runtime.stylePromptFile}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let onebot;
  const gateway = new DshTaskGateway({
    ctx,
    workspacePath: runtime.workspacePath,
    workspaceTitle: runtime.workspaceTitle,
    agentPreset: runtime.agentPreset,
    fallbackAgentPresets: runtime.fallbackAgentPresets,
    agentProvider: runtime.agentProvider,
    agentModel: runtime.agentModel,
    agentReasoningEffort: runtime.agentReasoningEffort,
    identityFile: join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "skills", "catgirl-rp", "SKILL.md"),
    identityTaskFile: join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "skills", "catgirl-rp", "identity-task.md"),
    identitySexFile: join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "skills", "catgirl-rp", "sex-persona.md"),
    emojiRoot: runtime.emojiRoot,
    botSelfId: runtime.botSelfId,
    emojiAccountIds: runtime.allowedContacts,
    maxAttachmentBytes: runtime.maxAttachmentBytes,
    maxImageBytes: runtime.maxImageBytes,
    filePreviewBytes: runtime.filePreviewBytes,
    attachments: ctx.attachments,
    sendPrivateMessage: (senderId, message) => onebot.sendPrivateMessage(senderId, message),
    stylePrompt,
    stateStore: new JsonStateStore(runtime.stateFile),
    log,
  });
  let channel;
  onebot = new OneBotClient({
    url: runtime.websocketUrl,
    token: runtime.accessToken,
    reconnectMs: runtime.reconnectMs,
    actionTimeoutMs: runtime.actionTimeoutMs,
    log,
    onEvent: (event) => channel.accept(event),
  });
  channel = new QqChannel({
    allowedContacts: runtime.allowedContacts,
    dispatchTask: (senderId, text, payload) => gateway.dispatch(senderId, text, payload),
    resolveAttachment: (attachment, userId) => onebot.resolveAttachment(attachment, userId),
    resetSession: (senderId) => gateway.reset(senderId),
    listHistory: (senderId) => gateway.historyText(senderId),
    switchSession: (senderId, target) => gateway.switchSession(senderId, target),
    sendPrivateMessage: (senderId, message) => gateway.sendQQMessage(senderId, message),
    statusText: () => [
      `QQ 渠道${onebot.connected ? "已连接" : "等待 OneBot 连接"}`,
      `工作区：${runtime.workspaceTitle}`,
      `联系人白名单：${runtime.allowedContacts.length} 个`,
      `允许联系人：${runtime.allowedContacts.join(",") || "无"}`,
      `联系人语气：${stylePrompt ? "已启用" : "未启用"}`,
      ...gateway.presetStatusLines(),
      `视觉模型：${runtime.agentModel}`,
      `推理强度：${runtime.agentReasoningEffort}`,
    ].join("\n"),
    log,
  });

  if (runtime.allowedContacts.length === 0) {
    log.warn(`QQ contact allow-list is empty; edit ${runtime.localConfigFile}`);
  }

  ctx.effect(() => {
    let disposed = false;
    const startup = gateway.start().then(() => {
      if (!disposed) onebot.start();
      log.info(`QQ channel workspace ready: ${runtime.workspacePath}`);
    }).catch((error) => {
      log.error(`QQ channel startup failed: ${error instanceof Error ? error.message : String(error)}`);
    });

    return async () => {
      disposed = true;
      await startup;
      await onebot.stop();
      await gateway.stop();
    };
  });
}

export default { name, inject, Config, apply };
