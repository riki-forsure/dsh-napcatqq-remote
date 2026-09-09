import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, writeFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assistantReplyAfter } from "./core.js";
import { createUserMessageCompat, installModelSelectionCompat } from "./dsh-compat.js";

/** 任务/技术请求特征：命中即按 task 模式注入精简人格，否则使用聊天人格。 */
const TASK_RE = /(\.(py|js|ts|jsx|tsx|sh|go|rs|json|ya?ml|toml|md|txt|c|cpp|java)\b)|(\/mnt\/[a-z]\/)|(^[A-Za-z]:\\)|(~\/)|(接口|项目|代码|文件|脚本|配置|服务|进程|日志|目录|程序|模块|函数|命令)(的)?(结构|问题|分析|写法|意思|在哪|是什么|报错)|(^|[^人])(报错|错误|崩溃|失败|挂了)|(帮我|给我|麻烦|请).{0,6}(改|写|创建|修|查|找|删|移|复制|运行|执行|安装|配置|分析|重构|优化|测试|调试|解释|对比|生成|部署|看|读|打开|关|启动|停止)|(怎么(办|修|弄|改|写)|什么原因|为什么|咋回事)/;

/** 情色请求特征：单独切换到可选的 sex persona 文件。 */
const SEX_RE = /(做爱|我要操|操你|操死|插入|干你|干我|性爱|上床|来一发|想要你|要了我)/;

export class JsonStateStore {
  constructor(path) {
    this.path = path;
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8"));
      return parsed && typeof parsed === "object" && parsed.sessions && typeof parsed.sessions === "object"
        ? parsed
        : { sessions: {} };
    } catch (error) {
      if (error?.code === "ENOENT") return { sessions: {} };
      throw error;
    }
  }

  async save(state) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.path);
  }
}

export class DshTaskGateway {
  constructor(options) {
    this.ctx = options.ctx;
    this.workspacePath = options.workspacePath;
    this.workspaceTitle = options.workspaceTitle ?? "QQ 渠道";
    this.agentPreset = options.agentPreset || undefined;
    this.fallbackAgentPresets = Array.isArray(options.fallbackAgentPresets)
      ? [...new Set(options.fallbackAgentPresets.map((value) => String(value).trim()).filter(Boolean))]
      : ["router-standard", "standard", "minimal"];
    this.selectedPresetId = undefined;
    this.availablePresetIds = undefined;
    this.presetNotice = "";
    this.agentProvider = options.agentProvider || undefined;
    this.agentModel = options.agentModel || undefined;
    this.agentReasoningEffort = options.agentReasoningEffort || undefined;
    this.installModelSelection = options.installModelSelection ?? installModelSelectionCompat;
    this.identityFile = options.identityFile || "";
    this.identityTaskFile = options.identityTaskFile || "";
    this.identitySexFile = options.identitySexFile || "";
    this.agentCtxs = new Map();
    this.personaState = new Map();
    this.modelSelections = new Map();
    this.stylePrompt = options.stylePrompt?.trim() || "";
    this.maxAttachmentBytes = options.maxAttachmentBytes ?? 50 * 1024 * 1024;
    this.maxImageBytes = options.maxImageBytes ?? 20 * 1024 * 1024;
    this.filePreviewBytes = options.filePreviewBytes ?? 8 * 1024;
    this.corpusPath = options.corpusPath || join(this.workspacePath, "corpus", "live");
    this.fetch = options.fetch ?? globalThis.fetch;
    this.attachments = options.attachments ?? options.ctx?.attachments;
    this.sendOneBotMessage = options.sendPrivateMessage;
    this.emojiRoot = String(options.emojiRoot ?? process.env.DSH_QQ_EMOJI_ROOT ?? "").trim();
    this.botSelfId = String(options.botSelfId ?? process.env.DSH_QQ_SELF_ID ?? "").trim();
    this.emojiAccountIds = Array.isArray(options.emojiAccountIds)
      ? options.emojiAccountIds.map((value) => String(value).trim()).filter(Boolean)
      : [];
    this.emojiPathCache = new Map();
    this.stateStore = options.stateStore;
    this.ensureDirectory = options.ensureDirectory ?? ((path) => mkdir(path, { recursive: true }));
    this.createMessage = options.createMessage ?? createUserMessageCompat;
    this.createSessionId = options.createSessionId ?? ((senderId) => `session-qq-${senderId}-${randomUUID()}`);
    this.log = options.log ?? { info() {}, warn() {}, error() {} };
    this.workspace = undefined;
    this.state = { sessions: {} };
    this.handles = new Map();
    this.ensureTails = new Map();
    this.dispatchGates = new Map();
    this.activeRuns = new Map();
    this.outboundTails = new Map();
    this.receivedImages = new Map();
    this.historySelections = new Map();
    this.persistTail = Promise.resolve();
  }

  async start() {
    await this.ensureDirectory(this.workspacePath);
    this.workspace = await this.ctx.workspaceRegistry.create(this.workspacePath, this.workspaceTitle);
    this.state = await this.stateStore.load();
    this.state.sessions ??= {};
    await this.refreshPresetSelection();
  }

  presetCandidates() {
    return [...new Set([
      this.agentPreset || this.ctx.agentPresets?.defaultId,
      ...this.fallbackAgentPresets,
      this.ctx.agentPresets?.defaultId,
      "standard",
      "minimal",
    ].map((value) => String(value ?? "").trim()).filter(Boolean))];
  }

  async refreshPresetSelection(excludedIds = []) {
    const excluded = new Set(excludedIds.map((value) => String(value)));
    const candidates = this.presetCandidates();
    const listPresets = this.ctx.agentPresets?.list;

    // 兼容较旧的 dsh / 测试替身；新版 dsh 会走下方的健康检查。
    if (typeof listPresets !== "function") {
      const selected = candidates.find((id) => !excluded.has(id));
      if (!selected) throw new Error(`没有可用的 Agent 预设；已尝试：${candidates.join("、")}`);
      this.selectedPresetId = selected;
      this.availablePresetIds = undefined;
      this.updatePresetNotice(selected);
      return selected;
    }

    const presets = await listPresets.call(this.ctx.agentPresets);
    this.availablePresetIds = new Set(
      presets
        .filter((preset) => preset && !preset.broken)
        .map((preset) => String(preset.id ?? "").trim())
        .filter(Boolean),
    );
    const selected = candidates.find((id) => this.availablePresetIds.has(id) && !excluded.has(id));
    if (!selected) {
      const available = [...this.availablePresetIds].join("、") || "无";
      throw new Error(`没有可用的 Agent 预设；已尝试：${candidates.join("、")}；当前可用：${available}`);
    }
    this.selectedPresetId = selected;
    this.updatePresetNotice(selected);
    return selected;
  }

  updatePresetNotice(selected) {
    const preferred = this.agentPreset || this.ctx.agentPresets?.defaultId || this.presetCandidates()[0];
    this.presetNotice = preferred && selected !== preferred
      ? `首选预设 ${preferred} 不可用，已降级为 ${selected}。`
      : "";
    if (this.presetNotice) this.log.warn?.(this.presetNotice);
  }

  presetStatusLines() {
    const selected = this.selectedPresetId || this.agentPreset || this.ctx.agentPresets?.defaultId || "未就绪";
    return [
      `Agent 预设：${selected}`,
      ...(this.presetNotice ? [`预设提示：${this.presetNotice}`] : []),
    ];
  }

  presetComposition(presetId, senderId) {
    const contactId = String(senderId);
    return {
      presetId,
      setup: async (agentCtx) => {
        await this.ctx.agentPresets.mount(agentCtx, presetId);
        if (typeof agentCtx?.tools?.restrict === "function") {
          agentCtx.tools.restrict({ deny: ["ask_user_question"] });
        } else {
          this.log.warn?.("当前 DSH 版本不支持 Agent 工具限制；QQ 渠道将仅通过系统提示避免调用 ask_user_question。请升级 DSH 以获得完整保护。");
        }
        if (typeof agentCtx?.on === "function" && (this.agentProvider || this.agentModel || this.agentReasoningEffort)) {
          const selection = {
            current: {
              provider: this.agentProvider,
              model: this.agentModel,
              reasoningEffort: this.agentReasoningEffort,
            },
            assembled: undefined,
          };
          this.modelSelections.set(contactId, selection);
          const installed = await this.installModelSelection(agentCtx, selection);
          if (!installed) {
            this.log.warn?.("当前 DSH 未公开 installModelSelection；将使用创建 Agent 时的 provider/model 兼容配置。");
          }
        }
        if (this.stylePrompt && typeof agentCtx?.systemPrompt?.section === "function") {
          agentCtx.systemPrompt.section({
            name: "qq-channel:contact-style",
            order: 10,
            text: this.stylePrompt,
          });
        }
        if (typeof agentCtx?.systemPrompt?.section === "function") {
          agentCtx.systemPrompt.section({
            name: "qq-channel:operator-identity",
            order: 9,
            text: [
              "你正在通过 QQ 和用户交流，同时实际运行在用户的电脑上。把自己当作正在操作这台电脑、检查文件和调用已安装工具的 dsh 助理来行动；不要把自己说成只会聊天的旁观者。",
              "涉及文件、图片、代码或配置时，先使用当前工作区和已安装工具核实，再给结论；不要假装已经读取了没有成功打开的内容。",
              "对用户保持自然的熟人私聊语气，具体措辞遵循 qq-channel:contact-style；语气可以口语化，但事实、路径、命令和执行结果必须准确。",
              "如果需要把本轮生成或找到的图片、文件发回 QQ，调用 qq_send_image 或 qq_send_file；不要只把路径写在回复里。",
              "收到的 QQ 内置表情会尽量从本机 QQ 缓存读取为真实图片交给视觉模型；收到的商城表情若带有真实图片也会保留。需要自然地用表情回应时，使用 qq_send_face（内置表情）或 qq_send_mface（有完整商城表情字段时），不要猜测缺失的商城 ID。",
              "QQ 渠道不提供 WebUI 弹窗。需要用户选择或补充信息时，把问题和清晰的编号选项作为普通文本发到 QQ，然后结束本轮；用户的下一条 QQ 消息会继续当前任务。不要调用 ask_user_question。",
            ].join("\n"),
          });
        }
        // 保存 setup 作用域；section 返回的 dispose 用于按请求类型切换人格。
        this.agentCtxs.set(contactId, agentCtx);
        if (typeof agentCtx?.systemPrompt?.section === "function") {
          const identityText = this.identityTextFor("chat");
          if (identityText) {
            this.personaState.set(contactId, {
              kind: "chat",
              dispose: agentCtx.systemPrompt.section({
                name: "qq-channel:identity",
                order: 8,
                text: identityText,
              }),
            });
          }
        }
        this.registerOutboundTools(agentCtx, contactId);
      },
    };
  }

  async persistedHeader(sessionId) {
    const headers = await this.ctx.sessionPersistence.list();
    return headers.find((header) => String(header.id) === sessionId);
  }

  sessionBelongsToContact(header, senderId) {
    const contactId = String(senderId);
    const sessionId = String(header?.id ?? "");
    return sessionId.startsWith(`session-qq-${contactId}-`)
      && sameWorkspacePath(header?.cwd, this.workspacePath)
      && header?.origin !== "subagent";
  }

  async contactHistory(senderId, limit = 10) {
    const contactId = String(senderId);
    const headers = (await this.ctx.sessionPersistence.list())
      .filter((header) => this.sessionBelongsToContact(header, contactId))
      .sort((left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0))
      .slice(0, limit);
    const entries = await Promise.all(headers.map(async (header) => ({
      id: String(header.id),
      createdAt: Number(header.createdAt ?? 0),
      title: await this.sessionDisplayTitle(header),
    })));
    this.historySelections.set(contactId, entries.map((entry) => entry.id));
    return entries;
  }

  async sessionDisplayTitle(header) {
    let events = [];
    try {
      const inspection = await this.ctx.sessionPersistence.inspect(String(header.id));
      events = Array.isArray(inspection?.events) ? inspection.events : [];
    } catch (error) {
      this.log.warn?.(`failed to inspect QQ session ${String(header.id)}: ${errorMessage(error)}`);
    }
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.type !== "session/title") continue;
      const title = compactTitle(event?.data?.title);
      if (title) return title;
    }
    for (const event of events) {
      if (event?.type !== "user/message") continue;
      const title = compactTitle(messageText(event?.data?.content));
      if (title) return title;
    }
    const id = String(header?.id ?? "");
    const marker = id.lastIndexOf("-");
    const tail = marker >= 0 ? id.slice(marker + 1) : id;
    return `对话 ${tail || "未命名"}`;
  }

  async historyText(senderId) {
    const contactId = String(senderId);
    const entries = await this.contactHistory(contactId, 10);
    if (entries.length === 0) {
      return "当前联系人还没有可切换的 QQ 历史对话。发送普通消息会自动新建对话。";
    }
    const current = this.state.sessions[contactId];
    return [
      "可切换的历史对话（仅当前联系人）：",
      ...entries.flatMap((entry, index) => [
        `${index + 1}. ${entry.id === current ? "[当前] " : ""}${entry.title}`,
        `   ${entry.id}`,
      ]),
      "发送 /切换 序号（例如 /切换 2），也可发送 /切换 完整会话ID。",
    ].join("\n");
  }

  async switchSession(senderId, requestedTarget) {
    const contactId = String(senderId);
    const requested = String(requestedTarget ?? "").trim();
    if (!requested) return "用法：/切换 序号；请先发送 /历史 查看可用序号。";
    return this.withDispatchGate(contactId, async () => {
      const currentId = this.state.sessions[contactId];
      const currentAgent = currentId ? this.ctx.agents.get(currentId) : undefined;
      if (this.activeRuns.has(contactId) || currentAgent?.status === "running") {
        return "当前对话正在工作，请等任务结束后再切换历史对话。";
      }

      let targetId = requested;
      if (/^\d+$/.test(requested)) {
        const choices = this.historySelections.get(contactId);
        if (!choices) return "请先发送 /历史，再用 /切换 序号选择刚刚看到的对话。";
        const index = Number(requested) - 1;
        if (!Number.isSafeInteger(index) || index < 0 || index >= choices.length) {
          return `序号超出范围；当前可选 1-${choices.length}。请重新发送 /历史 查看。`;
        }
        targetId = choices[index];
      }

      const headers = await this.ctx.sessionPersistence.list();
      const target = headers.find((header) => String(header.id) === targetId);
      if (!target) return `对话不存在：${targetId}`;
      if (!this.sessionBelongsToContact(target, contactId)) {
        return "该对话不属于当前联系人或当前 QQ 工作区，未执行切换。";
      }
      if (targetId === currentId) return `当前已经是该对话：${targetId}`;
      const targetAgent = this.ctx.agents.get(targetId);
      if (targetAgent?.status === "running") return "目标对话正在工作，请等任务结束后再切换。";

      this.state.sessions[contactId] = targetId;
      try {
        await this.saveState();
      } catch (error) {
        if (currentId) this.state.sessions[contactId] = currentId;
        else delete this.state.sessions[contactId];
        return `切换失败，原对话保持不变：${errorMessage(error)}`;
      }

      this.personaState.get(contactId)?.dispose?.();
      this.personaState.delete(contactId);
      this.agentCtxs.delete(contactId);
      this.modelSelections.delete(contactId);
      const handle = currentId ? this.handles.get(currentId) : undefined;
      if (handle) {
        this.handles.delete(currentId);
        await handle.dispose();
      }
      return `已切换到历史对话：${targetId}\n下一条普通 QQ 消息会在该对话中继续。`;
    });
  }

  async ensureAgent(senderId) {
    const contactId = String(senderId);
    const previous = this.ensureTails.get(contactId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => this.ensureAgentOnce(contactId));
    this.ensureTails.set(contactId, current);
    try {
      return await current;
    } finally {
      if (this.ensureTails.get(contactId) === current) this.ensureTails.delete(contactId);
    }
  }

  async ensureAgentOnce(senderId) {
    const contactId = String(senderId);
    const knownId = this.state.sessions[contactId];
    if (knownId) {
      const live = this.ctx.agents.get(knownId);
      if (live) return live;
      const stored = await this.persistedHeader(knownId);
      if (stored) {
        const presetId = stored.agentPreset || this.selectedPresetId || this.ctx.agentPresets.defaultId;
        if (!this.availablePresetIds || this.availablePresetIds.has(presetId)) {
          const composition = this.presetComposition(presetId, contactId);
          const handle = await this.ctx.agents.resume({
            resumeSessionId: knownId,
            agentOptions: this.agentOptions(),
            setup: composition.setup,
          });
          this.handles.set(knownId, handle);
          await this.workspace.attachSession(knownId);
          return handle.agent;
        }
        this.log.warn?.(`QQ session ${knownId} uses unavailable preset ${presetId}; preserving it and creating a replacement for ${contactId}`);
      }
    }

    const sessionId = this.createSessionId(contactId);
    const presetId = this.selectedPresetId || this.agentPreset || this.ctx.agentPresets.defaultId;
    const composition = this.presetComposition(presetId, contactId);
    const handle = await this.ctx.agents.create({
      sessionId,
      meta: {
        cwd: this.workspacePath,
        agentPreset: presetId,
      },
      agentOptions: this.agentOptions(),
      setup: composition.setup,
    });
    this.handles.set(sessionId, handle);
    await this.workspace.attachSession(sessionId);
    this.state.sessions[contactId] = sessionId;
    await this.saveState();
    this.log.info?.(`created QQ dsh session ${sessionId} for ${contactId}`);
    return handle.agent;
  }

  agentOptions() {
    return {
      ...(this.agentProvider ? { provider: this.agentProvider } : {}),
      ...(this.agentModel ? { model: this.agentModel } : {}),
    };
  }

  /** 意图粗分：任务请求加载 task persona，普通交流使用聊天 persona。 */
  classifyRequest(text) {
    const value = String(text ?? "").trim();
    if (!value) return "chat";
    if (SEX_RE.test(value)) return "sex";
    if (TASK_RE.test(value)) return "task";
    return "chat";
  }

  identityTextFor(kind) {
    const file = kind === "sex" ? this.identitySexFile : kind === "task" ? this.identityTaskFile : this.identityFile;
    if (!file) return "";
    try {
      return readFileSync(file, "utf8").trim();
    } catch {
      return "";
    }
  }

  ensureIdentity(senderId, kind) {
    const contactId = String(senderId);
    const state = this.personaState.get(contactId);
    if (state && state.kind === kind) return;
    state?.dispose?.();
    const agentCtx = this.agentCtxs.get(contactId);
    const text = this.identityTextFor(kind);
    const dispose = text && typeof agentCtx?.systemPrompt?.section === "function"
      ? agentCtx.systemPrompt.section({
        name: "qq-channel:identity",
        order: 8,
        text,
      })
      : undefined;
    this.personaState.set(contactId, { kind, dispose });
    const selection = this.modelSelections.get(contactId);
    if (selection?.current) {
      selection.current.reasoningEffort = kind === "task"
        ? (this.agentReasoningEffort || "max")
        : "max";
    }
  }

  saveState() {
    const snapshot = structuredClone(this.state);
    const save = this.persistTail.then(() => this.stateStore.save(snapshot));
    this.persistTail = save.catch(() => undefined);
    return save;
  }

  async dispatch(senderId, text, payload) {
    const contactId = String(senderId);
    if (payload?.selfId) this.botSelfId = String(payload.selfId).trim();
    // Keep the inbound ledger even when session creation or attachment
    // preparation fails; the QQ exchange must remain auditable.
    await this.appendConversationRecord(contactId, "in", text, payload);
    const agent = await this.ensureAgent(contactId);
    let before;
    let outcome;
    await this.withDispatchGate(contactId, async () => {
      const messageContent = await this.prepareContent(contactId, text, payload);
      const message = this.createMessage({
        content: messageContent,
        source: { kind: "user" },
      });
      const active = this.activeRuns.get(contactId);
      // Once the driver is idle, the run may still be finalizing attachment
      // delivery and corpus writes. Wait for that promise rather than steering
      // a new idle turn into a result that has not been snapshotted yet.
      // The driver can report `idle` for a short moment while followup() is
      // being picked up. The run marker closes that window for steering.
      if (agent.status === "running" || (active && !active.driverIdle)) {
        if (typeof agent.steer !== "function") {
          throw new Error("当前 dsh agent 不支持工作中插入对话");
        }
        agent.steer(message);
        const acknowledgement = "已把这条消息插入当前任务，当前任务完成后会继续回复。";
        await this.appendConversationRecord(contactId, "out", acknowledgement);
        outcome = { reply: acknowledgement };
        return;
      }

      // `whenIdle()` can resolve before outbound attachment delivery and the
      // live-corpus append finish. Do not start another ordinary turn until
      // that run's finalization has released the contact.
      if (active && !active.idleReached) await active.promise?.catch(() => undefined);
      before = agent.session.deriveMessages().length;

      const run = { agent, driverIdle: false, idleReached: false };
      this.activeRuns.set(contactId, run);
      try {
        agent.followup(message);
      } catch (error) {
        if (this.activeRuns.get(contactId) === run) this.activeRuns.delete(contactId);
        throw error;
      }
      run.promise = this.finishRun(contactId, run, before);
      outcome = { run: run.promise };
    });
    if (outcome?.reply !== undefined) return outcome.reply;
    return outcome?.run ? await outcome.run : "";
  }

  async finishRun(senderId, run, before) {
    const contactId = String(senderId);
    try {
      await run.agent.whenIdle();
      // From here the driver has stopped accepting work for this turn, but
      // outbound delivery and corpus persistence still need to finish.
      run.driverIdle = true;
      const messages = run.agent.session.deriveMessages();
      const reply = assistantReplyAfter(messages, before);
      await this.collectOutbound(contactId, messages, before);
      if (reply) await this.appendConversationRecord(contactId, "out", reply);
      // Keep the contact occupied until outbound attachments and the live
      // corpus record are both durable, not merely until the model driver is
      // idle.
      run.idleReached = true;
      return reply;
    } finally {
      if (this.activeRuns.get(contactId) === run) this.activeRuns.delete(contactId);
    }
  }

  async withDispatchGate(senderId, task) {
    const key = String(senderId);
    const previous = this.dispatchGates.get(key) ?? Promise.resolve();
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => held);
    this.dispatchGates.set(key, tail);
    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.dispatchGates.get(key) === tail) this.dispatchGates.delete(key);
    }
  }

  async appendConversationRecord(senderId, direction, text, payload = {}) {
    const contactId = String(senderId);
    const directory = join(this.corpusPath, safeDisplayName(contactId));
    const value = String(text ?? "").trim();
    const record = {
      schemaVersion: 1,
      id: `${direction}-${payload?.messageId || randomUUID()}`,
      timestamp: Math.floor(Date.now() / 1000),
      time: new Date().toISOString(),
      direction,
      speaker: direction === "out" ? "owner" : "contact",
      sender: direction === "out" ? "dsh" : contactId,
      peer: contactId,
      text: value,
      parts: direction === "in"
        ? serializableParts(payload?.parts)
        : [{ type: "text", text: value }],
      attachments: direction === "in" ? serializableAttachments(payload?.attachments) : [],
      source: { kind: "qq-live" },
    };
    try {
      await this.ensureDirectory(directory);
      await appendFile(join(directory, "dialogue.jsonl"), `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
    } catch (error) {
      this.log.warn?.(`QQ dialogue corpus could not be appended for ${contactId}: ${errorMessage(error)}`);
    }
  }

  async prepareContent(senderId, text, payload) {
    const contactId = String(senderId);
    const parts = Array.isArray(payload?.parts) ? payload.parts : [{ type: "text", text }];
    const content = [];
    let textBuffer = "";
    const flushText = () => {
      if (!textBuffer) return;
      content.push({ type: "text", text: textBuffer });
      textBuffer = "";
    };
    for (const part of parts) {
      if (part?.type === "text") {
        textBuffer += String(part.text ?? "");
        continue;
      }
      if (part?.type === "image") {
        flushText();
        const ref = await this.saveImageAttachment(contactId, part.attachment);
        content.push({
          type: "text",
          text: `[QQ 图片：${safeDisplayName(ref.name || part.attachment?.name || "qq-image")}；如需原样发回，可调用 qq_send_image，attachment_id=${ref.attachmentId}]`,
        });
        content.push({ type: "image", attachment: ref });
        continue;
      }
      if (part?.type === "face" || part?.type === "mface") {
        const emojiAttachment = await this.resolveEmojiImage(contactId, part);
        if (emojiAttachment) {
          flushText();
          try {
            const ref = await this.saveImageAttachment(contactId, emojiAttachment);
            content.push({
              type: "text",
              text: `${part.text || "[QQ 表情]"}；已读取真实表情图片，如需原样发回，可调用 qq_send_image，attachment_id=${ref.attachmentId}`,
            });
            content.push({ type: "image", attachment: ref });
          } catch (error) {
            this.log.warn?.(`QQ emoji image could not be persisted for ${contactId}: ${errorMessage(error)}`);
            textBuffer += `${part.text || "[QQ 表情]"}（真实图片未能读取：${errorMessage(error)}）`;
          }
        } else {
          textBuffer += String(part.text || (part.type === "face" ? "[QQ 表情]" : "[QQ 商城表情]"));
        }
        continue;
      }
      if (part?.type === "file") {
        flushText();
        try {
          const description = await this.saveFileAttachment(contactId, part.attachment);
          textBuffer += description;
        } catch (error) {
          this.log.warn?.(`QQ file could not be persisted for ${contactId}: ${errorMessage(error)}`);
          textBuffer += `${part.text || "[文件]"}（文件未能保存：${errorMessage(error)}）`;
        }
        continue;
      }
    }
    flushText();
    if (content.length === 0) content.push({ type: "text", text: String(text ?? "") });
    return content;
  }

  async resolveEmojiImage(senderId, part) {
    const attachment = part?.attachment && typeof part.attachment === "object" ? part.attachment : {};
    if (hasImageReference(attachment)) return attachment;
    if (part?.type === "face") {
      const faceId = String(part.faceId ?? attachment.faceId ?? "").trim();
      const path = await this.findEmojiFile(
        `face:${this.botSelfId}:${faceId}`,
        () => this.standardEmojiCandidates(faceId),
      );
      return path ? { file: path, name: `qq-face-${faceId}.png`, faceId } : null;
    }
    const localPath = await this.findEmojiFile(
      `mface:${this.botSelfId}:${attachment.emojiPackageId}:${attachment.emojiId}:${attachment.emojiKey}`,
      () => this.marketEmojiCandidates(attachment),
    );
    if (localPath) {
      return {
        ...attachment,
        file: localPath,
        name: `qq-mface-${attachment.emojiId || "sticker"}.png`,
      };
    }
    const remoteUrl = marketEmojiUrl(attachment);
    return remoteUrl
      ? { ...attachment, url: remoteUrl, name: `qq-mface-${attachment.emojiId || "sticker"}.gif` }
      : null;
  }

  emojiRoots() {
    const roots = [];
    if (this.emojiRoot) roots.push(localPathFromReference(this.emojiRoot) || this.emojiRoot);
    const accountIds = [...new Set([this.botSelfId, ...this.emojiAccountIds].map((value) => String(value || "").trim()).filter(Boolean))];
    const windowsUsers = [...new Set([
      process.env.DSH_QQ_WINDOWS_USER,
      process.env.USERNAME,
      process.env.USER,
      process.env.LOGNAME,
    ].map((value) => String(value || "").trim()).filter(Boolean))];
    if (accountIds.length > 0) {
      for (const drive of ["c", "d", "e", "f", "g"]) {
        for (const accountId of accountIds) {
          roots.push(`/mnt/${drive}/QQrecord/Tencent Files/${accountId}/nt_qq/nt_data/Emoji`);
          for (const windowsUser of windowsUsers) {
            roots.push(`/mnt/${drive}/Users/${windowsUser}/Documents/Tencent Files/${accountId}/nt_qq/nt_data/Emoji`);
            roots.push(`/mnt/${drive}/Users/${windowsUser}/Tencent Files/${accountId}/nt_qq/nt_data/Emoji`);
          }
        }
      }
    }
    return [...new Set(roots.filter(Boolean))];
  }

  standardEmojiCandidates(faceId) {
    if (!/^\d{1,8}$/.test(faceId)) return [];
    return this.emojiRoots().flatMap((root) => [
      join(root, "BaseEmojiSyastems", "EmojiSystermResource", faceId, "apng", `${faceId}.png`),
      join(root, "BaseEmojiSyastems", "EmojiSystermResource", faceId, "png", `${faceId}.png`),
      join(root, "emoji-related", `${faceId}.png`),
      join(root, "emoji-related", `${faceId}.gif`),
    ]);
  }

  marketEmojiCandidates(attachment) {
    const packageId = safePathSegment(attachment?.emojiPackageId);
    const emojiId = safePathSegment(attachment?.emojiId);
    if (!packageId || !emojiId) return [];
    return this.emojiRoots().flatMap((root) => [
      join(root, "marketface", packageId, `${emojiId}_aio.png`),
      join(root, "marketface", packageId, `${emojiId}_aio.gif`),
      join(root, "marketface", packageId, emojiId),
    ]);
  }

  async findEmojiFile(key, candidates) {
    if (this.emojiPathCache.has(key)) return this.emojiPathCache.get(key);
    let found = null;
    for (const candidate of candidates()) {
      const info = await stat(candidate).catch(() => null);
      if (info?.isFile() && info.size <= this.maxImageBytes) {
        found = candidate;
        break;
      }
    }
    this.emojiPathCache.set(key, found);
    return found;
  }

  async saveImageAttachment(senderId, attachment) {
    const contactId = String(senderId);
    if (!this.attachments?.saveImage) {
      throw new Error("dsh 未挂载图片附件存储，无法把 QQ 图片送入视觉模型");
    }
    const downloaded = await this.downloadAttachment(attachment, "image");
    if (!downloaded?.data?.byteLength) {
      throw new Error("无法从 OneBot 获取 QQ 图片的真实文件内容");
    }
    const mediaType = detectImageMediaType(downloaded.data, attachment?.mediaType, downloaded.mediaType);
    if (!mediaType) throw new Error("无法识别图片格式，仅支持 PNG/JPEG/WebP/GIF");
    if (downloaded.data.byteLength > this.maxImageBytes) {
      throw new Error(`图片超过 ${this.maxImageBytes} 字节限制`);
    }
    const ref = await this.attachments.saveImage({
      data: downloaded.data,
      mediaType,
      name: safeDisplayName(attachment?.name || downloaded.name || "qq-image"),
    });
    const attachmentId = String(ref.attachmentId);
    this.receivedImages.set(`${contactId}:${attachmentId}`, { ref, data: downloaded.data, mediaType });
    while (this.receivedImages.size > 256) this.receivedImages.delete(this.receivedImages.keys().next().value);
    return ref;
  }

  async saveFileAttachment(senderId, attachment) {
    const contactId = String(senderId);
    const name = safeDisplayName(attachment?.name || attachment?.file || "qq-attachment");
    const directory = join(this.workspacePath, ".qq-inbox", safeDisplayName(contactId));
    await this.ensureDirectory(directory);
    const target = join(directory, `${Date.now()}-${randomUUID().slice(0, 8)}-${name}`);
    const downloaded = await this.downloadAttachment(attachment, "file");
    if (!downloaded) {
      return `[文件: ${name}]（未找到可下载地址，请让对方重新发送）`;
    }
    if (downloaded.data.byteLength > this.maxAttachmentBytes) {
      throw new Error(`文件超过 ${this.maxAttachmentBytes} 字节限制`);
    }
    await writeFile(target, downloaded.data, { mode: 0o600 });
    const preview = await previewFile(downloaded.data, name, this.filePreviewBytes);
    const details = [`[文件: ${name}]`, `已保存到 ${target}`, "需要时请用文件工具读取该路径。"];
    if (preview) details.push(`文件开头预览（最多 ${this.filePreviewBytes} 字节）：\n${preview}`);
    return details.join("\n");
  }

  registerOutboundTools(agentCtx, senderId) {
    const tools = agentCtx?.tools || agentCtx?.get?.("tools");
    if (!tools || typeof tools.register !== "function" || typeof this.sendOneBotMessage !== "function") return;
    const gateway = this;
    const output = {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          sent: { type: "boolean" },
          kind: { type: "string" },
          name: { type: "string" },
        },
        required: ["sent", "kind", "name"],
      },
      render: (_args, value) => [{
        type: "text",
        text: `已通过 QQ 发送${({ image: "图片", file: "文件", face: "QQ 表情", mface: "QQ 商城表情" })[value.kind] || "内容"}：${value.name}`,
      }],
    };
    tools.register({
      name: "qq_send_image",
      description: "把工作区或已接收的图片真实发送给当前 QQ 联系人。file_path 与 attachment_id 至少提供一个；需要原样转发刚收到的图片时使用 attachment_id。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          file_path: { type: "string" },
          attachment_id: { type: "string" },
          caption: { type: "string" },
        },
      },
      output,
      isConcurrencySafe: () => false,
      async execute(args) {
        const image = await gateway.readOutboundImage(args, senderId);
        await gateway.sendPrivateAttachment(senderId, "image", image.data, image.mediaType, image.name, args.caption);
        return { sent: true, kind: "image", name: image.name };
      },
    });
    tools.register({
      name: "qq_send_file",
      description: "把工作区中的真实文件发送给当前 QQ 联系人。file_path 必须指向已经存在的文件；文件会以二进制内容发送，而不是只发送路径。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          file_path: { type: "string" },
          name: { type: "string" },
          caption: { type: "string" },
        },
        required: ["file_path"],
      },
      output,
      isConcurrencySafe: () => false,
      async execute(args) {
        const file = await gateway.readOutboundFile(args.file_path, args.name);
        await gateway.sendPrivateAttachment(senderId, "file", file.data, file.mediaType, file.name, args.caption);
        return { sent: true, kind: "file", name: file.name };
      },
    });
    tools.register({
      name: "qq_send_face",
      description: "向当前 QQ 联系人发送一个 QQ 内置表情。face_id 必须是收到的表情编号或 QQ 支持的数字编号，不要猜商城表情字段。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          face_id: { type: "string" },
          caption: { type: "string" },
        },
        required: ["face_id"],
      },
      output,
      isConcurrencySafe: () => false,
      async execute(args) {
        const faceId = normalizeFaceId(args?.face_id);
        const message = [];
        if (String(args?.caption ?? "").trim()) {
          message.push({ type: "text", data: { text: String(args.caption).trim() } });
        }
        message.push({ type: "face", data: { id: faceId } });
        await gateway.sendQQMessage(senderId, message);
        return { sent: true, kind: "face", name: faceId };
      },
    });
    tools.register({
      name: "qq_send_mface",
      description: "向当前 QQ 联系人发送 QQ 商城表情。必须提供收到消息中的完整 emoji_id 和 emoji_package_id；key、summary 可选，缺失时不要猜。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          emoji_id: { type: "string" },
          emoji_package_id: { type: "string" },
          key: { type: "string" },
          summary: { type: "string" },
          caption: { type: "string" },
        },
        required: ["emoji_id", "emoji_package_id"],
      },
      output,
      isConcurrencySafe: () => false,
      async execute(args) {
        const emojiId = normalizeEmojiField(args?.emoji_id, "emoji_id");
        const emojiPackageId = normalizeEmojiField(args?.emoji_package_id, "emoji_package_id");
        const message = [];
        if (String(args?.caption ?? "").trim()) {
          message.push({ type: "text", data: { text: String(args.caption).trim() } });
        }
        message.push({
          type: "mface",
          data: {
            emoji_id: emojiId,
            emoji_package_id: emojiPackageId,
            ...(String(args?.key ?? "").trim() ? { key: String(args.key).trim() } : {}),
            ...(String(args?.summary ?? "").trim() ? { summary: String(args.summary).trim() } : {}),
          },
        });
        await gateway.sendQQMessage(senderId, message);
        return { sent: true, kind: "mface", name: `${emojiPackageId}/${emojiId}` };
      },
    });
  }

  async readOutboundImage(args, senderId) {
    const attachmentId = String(args?.attachment_id ?? "").trim();
    if (attachmentId) {
      const contactId = String(senderId);
      const cached = this.receivedImages.get(`${contactId}:${attachmentId}`);
      if (!cached) throw new Error(`找不到仍可发送的图片附件 ${attachmentId}；请改用 file_path`);
      if (typeof this.attachments?.readImage === "function") {
        const stored = await this.attachments.readImage(cached.ref);
        return {
          data: stored.data,
          mediaType: stored.ref?.mediaType || cached.mediaType,
          name: stored.ref?.name || cached.ref?.name || "qq-image",
        };
      }
      return { data: cached.data, mediaType: cached.mediaType, name: cached.ref?.name || "qq-image" };
    }
    const filePath = String(args?.file_path ?? "").trim();
    if (!filePath) throw new Error("qq_send_image 需要 file_path 或 attachment_id");
    const file = await this.readOutboundFile(filePath);
    const mediaType = detectImageMediaType(file.data, file.mediaType, undefined);
    if (!mediaType) throw new Error("qq_send_image 仅支持 PNG/JPEG/WebP/GIF 图片");
    return { ...file, mediaType };
  }

  async readOutboundFile(filePath, name) {
    const reference = stripNtOsPrefix(String(filePath ?? "").trim());
    if (!reference) throw new Error("文件路径不能为空");
    const localPath = localPathFromReference(reference) || resolve(this.workspacePath, reference);
    const info = await stat(localPath).catch((error) => {
      if (error?.code === "ENOENT") throw new Error(`文件不存在：${localPath}`);
      throw error;
    });
    if (!info.isFile()) throw new Error(`不是普通文件：${localPath}`);
    if (info.size > this.maxAttachmentBytes) throw new Error(`文件超过 ${this.maxAttachmentBytes} 字节限制`);
    return {
      data: new Uint8Array(await readFile(localPath)),
      mediaType: mediaTypeForFileName(localPath),
      name: safeDisplayName(name || basename(localPath)),
    };
  }

  async sendPrivateAttachment(senderId, kind, data, mediaType, name, caption) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data ?? []);
    const limit = kind === "image" ? this.maxImageBytes : this.maxAttachmentBytes;
    if (bytes.byteLength === 0) throw new Error("要发送的附件为空");
    if (bytes.byteLength > limit) throw new Error(`要发送的${kind === "image" ? "图片" : "文件"}超过 ${limit} 字节限制`);
    const file = `base64://${Buffer.from(bytes).toString("base64")}`;
    const segment = {
      type: kind,
      data: {
        file,
        ...(kind === "file" ? { name: safeDisplayName(name || "qq-attachment") } : {}),
      },
    };
    const message = [];
    if (String(caption ?? "").trim()) message.push({ type: "text", data: { text: String(caption).trim() } });
    message.push(segment);
    await this.sendQQMessage(senderId, message);
  }

  async sendQQMessage(senderId, message) {
    if (typeof this.sendOneBotMessage !== "function") throw new Error("OneBot 发送能力未连接");
    const key = String(senderId);
    const previous = this.outboundTails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => this.sendOneBotMessage(key, message));
    this.outboundTails.set(key, current);
    try {
      return await current;
    } finally {
      if (this.outboundTails.get(key) === current) this.outboundTails.delete(key);
    }
  }

  async collectOutbound(senderId, messages, startIndex) {
    const sent = new Set();
    for (const message of messages.slice(startIndex)) {
      if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
      for (const block of message.content) {
        if (block?.type !== "image" || !block.attachment) continue;
        const id = String(block.attachment.attachmentId ?? "");
        if (id && sent.has(id)) continue;
        if (id) sent.add(id);
        if (typeof this.attachments?.readImage !== "function") {
          throw new Error("dsh 生成了图片，但当前环境没有图片读取服务，无法发回 QQ");
        }
        const stored = await this.attachments.readImage(block.attachment);
        await this.sendPrivateAttachment(
          senderId,
          "image",
          stored.data,
          stored.ref?.mediaType || block.attachment.mediaType,
          stored.ref?.name || block.attachment.name || "dsh-image",
        );
      }
    }
  }

  async downloadAttachment(attachment, kind) {
    const item = attachment && typeof attachment === "object" ? attachment : {};
    const references = [
      item.url,
      item.file,
      item.filePath,
      item.file_path,
      item.localPath,
      item.local_path,
      item.base64,
      typeof item.data === "string" ? item.data : "",
    ]
      .map((value) => stripNtOsPrefix(value))
      .filter(Boolean);
    if (references.length === 0) return null;

    const limit = kind === "image" ? this.maxImageBytes : this.maxAttachmentBytes;
    const visited = new Set();
    let lastDownloadError;
    for (const reference of references) {
      const direct = normalizeRemoteReference(reference);
      if (visited.has(direct)) continue;
      visited.add(direct);

      const localPath = localPathFromReference(direct);
      if (localPath) {
        try {
          const info = await stat(localPath);
          if (!info.isFile()) continue;
          if (info.size > limit) throw new Error(`附件超过 ${limit} 字节限制`);
          return { data: new Uint8Array(await readFile(localPath)), name: basename(localPath) };
        } catch (error) {
          if (error?.code === "ENOENT") continue;
          throw error;
        }
      }

      if (/^data:/i.test(direct)) {
        const decoded = decodeDataUrl(direct);
        if (!decoded?.data?.byteLength) continue;
        if (decoded.data.byteLength > limit) throw new Error(`附件超过 ${limit} 字节限制`);
        return decoded;
      }
      if (/^base64:|^base64:\/\//i.test(direct)) {
        const decoded = decodeBase64Reference(direct);
        if (!decoded?.data?.byteLength) continue;
        if (decoded.data.byteLength > limit) throw new Error(`附件超过 ${limit} 字节限制`);
        return decoded;
      }
      if (!this.fetch || !/^https?:\/\//i.test(direct)) continue;

      try {
        const response = await this.fetch(direct, { redirect: "follow" });
        if (!response.ok) {
          lastDownloadError = new Error(`下载附件失败（HTTP ${response.status}）`);
          continue;
        }
        const length = Number(response.headers.get("content-length"));
        if (Number.isSafeInteger(length) && length > limit) {
          throw new Error(`附件超过 ${limit} 字节限制`);
        }
        const data = new Uint8Array(await response.arrayBuffer());
        if (data.byteLength > limit) throw new Error(`附件超过 ${limit} 字节限制`);
        return {
          data,
          mediaType: response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase(),
          name: basename(new URL(direct).pathname) || undefined,
        };
      } catch (error) {
        if (error instanceof Error && /附件超过/.test(error.message)) throw error;
        lastDownloadError = error;
      }
    }
    if (lastDownloadError) throw lastDownloadError;
    return null;
  }

  async reset(senderId) {
    const contactId = String(senderId);
    const sessionId = this.state.sessions[contactId];
    delete this.state.sessions[contactId];
    this.personaState.get(contactId)?.dispose?.();
    this.personaState.delete(contactId);
    this.agentCtxs.delete(contactId);
    this.modelSelections.delete(contactId);
    this.historySelections.delete(contactId);
    await this.saveState();
    const handle = sessionId ? this.handles.get(sessionId) : undefined;
    if (handle) {
      this.handles.delete(sessionId);
      await handle.dispose();
    }
  }

  async stop() {
    await this.persistTail;
    const handles = [...this.handles.values()];
    this.handles.clear();
    await Promise.allSettled(handles.map((handle) => handle.dispose()));
  }
}

function sameWorkspacePath(left, right) {
  const normalize = (value) => {
    const path = String(value ?? "").trim().replaceAll("\\", "/").replace(/\/+$/, "");
    return /^[A-Za-z]:\//.test(path) ? path.toLowerCase() : path;
  };
  const a = normalize(left);
  const b = normalize(right);
  return Boolean(a && b && a === b);
}

function messageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join(" ");
}

function compactTitle(value, maxLength = 48) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function safeDisplayName(value) {
  const raw = basename(String(value ?? "").replaceAll("\\", "/")).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const safe = raw.replace(/[<>:"/|?*]/g, "_");
  return (safe || "qq-attachment").slice(0, 160);
}

function safePathSegment(value) {
  const item = String(value ?? "").trim();
  return /^[A-Za-z0-9._-]{1,200}$/.test(item) ? item : "";
}

function normalizeFaceId(value) {
  const item = String(value ?? "").trim();
  if (!/^\d{1,8}$/.test(item)) throw new Error("qq_send_face 的 face_id 必须是 1-8 位数字");
  return item;
}

function normalizeEmojiField(value, name) {
  const item = String(value ?? "").trim();
  if (!safePathSegment(item)) throw new Error(`qq_send_mface 的 ${name} 不能为空且只能包含安全字符`);
  return item;
}

function hasImageReference(attachment) {
  return [attachment?.url, attachment?.file, attachment?.base64]
    .some((value) => String(value ?? "").trim());
}

function marketEmojiUrl(attachment) {
  const emojiId = safePathSegment(attachment?.emojiId);
  const packageId = safePathSegment(attachment?.emojiPackageId);
  if (!emojiId || !packageId) return null;
  const prefix = emojiId.slice(0, 2).padStart(2, "0");
  return `https://gxh.vip.qq.com/club/item/parcel/item/${prefix}/${encodeURIComponent(emojiId)}/raw300.gif`;
}

function localPathFromReference(value) {
  const raw = stripNtOsPrefix(value);
  if (!raw || /^data:/i.test(raw) || /^https?:\/\//i.test(raw)) return null;
  if (/^file:/i.test(raw)) {
    try {
      const parsed = fileURLToPath(raw);
      const windowsPath = parsed.match(/^\/([a-zA-Z]):[\\/](.*)$/);
      return localPathFromReference(windowsPath ? `${windowsPath[1]}:/${windowsPath[2]}` : parsed);
    } catch {
      return null;
    }
  }
  const windows = raw.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (windows) return `/mnt/${windows[1].toLowerCase()}/${windows[2].replaceAll("\\", "/")}`;
  if (raw.startsWith("/")) return raw;
  return null;
}

function normalizeRemoteReference(value) {
  const raw = stripNtOsPrefix(value);
  return raw.startsWith("//") ? `http:${raw}` : raw;
}

function stripNtOsPrefix(value) {
  return String(value ?? "").trim().replace(/^::NTOSFull::/i, "");
}

function serializableAttachment(value) {
  if (!value || typeof value !== "object") return {};
  const result = {};
  for (const key of [
    "type", "name", "file", "url", "fileId", "size", "mediaType", "error",
    "faceId", "emojiId", "emojiPackageId", "emojiKey", "emojiSummary",
  ]) {
    const item = value[key];
    if (item === undefined || item === null || item === "") continue;
    if (key === "size") {
      const size = Number(item);
      result.size = Number.isSafeInteger(size) && size >= 0 ? size : String(item);
      continue;
    }
    result[key] = String(item);
  }
  if (result.file) {
    const normalized = stripNtOsPrefix(result.file);
    if (normalized !== result.file) {
      result.sourceFile = result.file;
      result.file = normalized;
    }
  }
  return result;
}

function serializableParts(parts) {
  if (!Array.isArray(parts)) return [];
  return parts.map((part) => {
    const result = { type: String(part?.type ?? "text") };
    if (part?.text !== undefined && part?.text !== null) result.text = String(part.text);
    if (part?.faceId !== undefined && part?.faceId !== null && part.faceId !== "") result.faceId = String(part.faceId);
    if (part?.attachment) result.attachment = serializableAttachment(part.attachment);
    return result;
  });
}

function serializableAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments.map((attachment) => serializableAttachment(attachment));
}

function decodeDataUrl(value) {
  const match = String(value).match(/^data:([^;,]+)?(;base64)?,(.*)$/is);
  if (!match) return null;
  const mediaType = (match[1] || "").toLowerCase() || undefined;
  const data = match[2]
    ? new Uint8Array(Buffer.from(match[3], "base64"))
    : new Uint8Array(Buffer.from(decodeURIComponent(match[3]), "utf8"));
  return { data, mediaType };
}

function decodeBase64Reference(value) {
  const raw = String(value).replace(/^base64:\/\//i, "").replace(/^base64:/i, "").replace(/^,/, "");
  if (!raw) return null;
  return { data: new Uint8Array(Buffer.from(raw, "base64")) };
}

function normalizeMediaType(value) {
  const type = String(value ?? "").split(";", 1)[0].trim().toLowerCase();
  if (type === "image/jpg" || type === "image/pjpeg") return "image/jpeg";
  if (type === "image/x-png") return "image/png";
  return ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(type) ? type : undefined;
}

function mediaTypeForFileName(value) {
  const extension = extname(String(value ?? "")).toLowerCase();
  return {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".jsonl": "application/jsonl",
    ".csv": "text/csv",
    ".xml": "application/xml",
    ".html": "text/html",
    ".htm": "text/html",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
  }[extension];
}

function detectImageMediaType(data, declared, responseType) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data ?? []);
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6) {
    const signature = String.fromCharCode(...bytes.subarray(0, 6));
    if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  }
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  return normalizeMediaType(declared) || normalizeMediaType(responseType);
}

async function previewFile(data, name, maxBytes) {
  const lower = String(name ?? "").toLowerCase();
  const textExtensions = new Set([
    ".txt", ".md", ".markdown", ".json", ".jsonl", ".csv", ".tsv", ".log", ".xml", ".html", ".htm",
    ".yaml", ".yml", ".ini", ".conf", ".cfg", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py",
    ".java", ".go", ".rs", ".sql", ".sh", ".bat", ".ps1",
  ]);
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data ?? []);
  if (bytes.length === 0 || (!textExtensions.has(extname(lower)) && bytes.subarray(0, Math.min(bytes.length, 4096)).includes(0))) return "";
  const sample = bytes.subarray(0, Math.min(bytes.length, maxBytes));
  const text = new TextDecoder("utf-8", { fatal: false }).decode(sample).replace(/\u0000/g, "�").trim();
  if (!text) return "";
  return text + (bytes.length > sample.length ? "\n…（预览已截断）" : "");
}
