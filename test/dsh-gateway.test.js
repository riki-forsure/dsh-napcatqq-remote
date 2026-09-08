import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { DshTaskGateway } from "../lib/dsh-gateway.js";

function fakeAgent(id) {
  const messages = [];
  return {
    id,
    status: "idle",
    session: {
      header: { cwd: "/project/qq-workspace" },
      deriveMessages: () => [...messages],
    },
    followup(message) {
      messages.push(message);
      messages.push({ role: "assistant", content: [{ type: "text", text: "任务已完成" }] });
    },
    whenIdle: async () => undefined,
  };
}

function presetTestGateway({ presets, defaultId = "standard", state = { sessions: {} }, overrides = {} }) {
  return new DshTaskGateway({
    ctx: {
      workspaceRegistry: { create: async () => ({ attachSession: async () => undefined }) },
      agentPresets: {
        defaultId,
        list: async () => presets,
        mount: async () => undefined,
      },
      ...overrides.ctx,
    },
    workspacePath: "/project/qq-workspace",
    agentPreset: "router-auto",
    fallbackAgentPresets: ["router-standard", "standard", "minimal"],
    stateStore: { load: async () => structuredClone(state), save: async () => undefined },
    ensureDirectory: async () => undefined,
    ...overrides,
  });
}

test("DshTaskGateway prefers router-auto when it is healthy", async () => {
  const gateway = presetTestGateway({
    presets: [{ id: "router-auto" }, { id: "router-standard" }, { id: "standard" }],
  });

  await gateway.start();

  assert.equal(gateway.selectedPresetId, "router-auto");
  assert.deepEqual(gateway.presetStatusLines(), ["Agent 预设：router-auto"]);
});

test("DshTaskGateway falls back through healthy presets and reports the downgrade", async () => {
  const gateway = presetTestGateway({
    presets: [
      { id: "router-auto", broken: "missing dependency" },
      { id: "router-standard" },
      { id: "standard" },
    ],
  });

  await gateway.start();

  assert.equal(gateway.selectedPresetId, "router-standard");
  assert.match(gateway.presetStatusLines().join("\n"), /Agent 预设：router-standard/);
  assert.match(gateway.presetStatusLines().join("\n"), /router-auto.*不可用|已降级/);
});

test("DshTaskGateway works with only the built-in standard and minimal presets", async () => {
  const gateway = presetTestGateway({
    presets: [{ id: "standard" }, { id: "minimal" }],
  });

  await gateway.start();

  assert.equal(gateway.selectedPresetId, "standard");
  assert.match(gateway.presetStatusLines().join("\n"), /已降级为 standard/);
});

test("DshTaskGateway fails clearly when no candidate preset is available", async () => {
  const gateway = presetTestGateway({
    presets: [{ id: "router-auto", broken: "invalid preset" }],
    defaultId: "router-auto",
  });

  await assert.rejects(gateway.start(), /没有可用的 Agent 预设.*已尝试.*当前可用：无/);
});

test("preset setup completes without returning a value for agent-loop to commit", async () => {
  const mountedPreset = { id: "router-auto" };
  const gateway = new DshTaskGateway({
    ctx: {
      agentPresets: {
        mount: async () => mountedPreset,
      },
    },
    workspacePath: "/project/qq-workspace",
    stateStore: { load: async () => ({ sessions: {} }), save: async () => undefined },
  });

  const setupResult = await gateway.presetComposition("router-auto").setup({});

  assert.equal(setupResult, undefined);
});

test("preset setup disables WebUI-only questions and asks for QQ-visible numbered choices", async () => {
  const restrictions = [];
  const sections = [];
  const gateway = new DshTaskGateway({
    ctx: { agentPresets: { mount: async () => undefined } },
    workspacePath: "/project/qq-workspace",
    stateStore: { load: async () => ({ sessions: {} }), save: async () => undefined },
  });

  await gateway.presetComposition("router-auto", "10001").setup({
    tools: { restrict: (value) => restrictions.push(value) },
    systemPrompt: { section: (value) => sections.push(value) },
  });

  assert.deepEqual(restrictions, [{ deny: ["ask_user_question"] }]);
  const operatorPrompt = sections.find((section) => section.name === "qq-channel:operator-identity")?.text ?? "";
  assert.match(operatorPrompt, /编号选项/);
  assert.match(operatorPrompt, /普通文本/);
  assert.match(operatorPrompt, /结束本轮/);
  assert.match(operatorPrompt, /下一条 QQ 消息/);
});

test("preset setup keeps older DSH versions working when tool restriction is unavailable", async () => {
  const warnings = [];
  const gateway = new DshTaskGateway({
    ctx: { agentPresets: { mount: async () => undefined } },
    workspacePath: "/project/qq-workspace",
    stateStore: { load: async () => ({ sessions: {} }), save: async () => undefined },
    log: { info() {}, warn: (message) => warnings.push(message), error() {} },
  });

  await assert.doesNotReject(
    gateway.presetComposition("router-auto", "10001").setup({
      systemPrompt: { section: () => undefined },
    }),
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /ask_user_question|工具限制/);
});

test("preset setup mounts the QQ contact style in the agent scope", async () => {
  const sections = [];
  const gateway = new DshTaskGateway({
    ctx: { agentPresets: { mount: async () => undefined } },
    workspacePath: "/project/qq-workspace",
    stylePrompt: "回复保持简短口语。",
    stateStore: { load: async () => ({ sessions: {} }), save: async () => undefined },
  });

  await gateway.presetComposition("router-auto").setup({
    systemPrompt: { section: (value) => sections.push(value) },
  });

  assert.deepEqual(sections, [
    {
      name: "qq-channel:contact-style",
      order: 10,
      text: "回复保持简短口语。",
    },
    {
      name: "qq-channel:operator-identity",
      order: 9,
      text: "你正在通过 QQ 和用户交流，同时实际运行在用户的电脑上。把自己当作正在操作这台电脑、检查文件和调用已安装工具的 dsh 助理来行动；不要把自己说成只会聊天的旁观者。\n涉及文件、图片、代码或配置时，先使用当前工作区和已安装工具核实，再给结论；不要假装已经读取了没有成功打开的内容。\n对用户保持自然的熟人私聊语气，具体措辞遵循 qq-channel:contact-style；语气可以口语化，但事实、路径、命令和执行结果必须准确。\n如果需要把本轮生成或找到的图片、文件发回 QQ，调用 qq_send_image 或 qq_send_file；不要只把路径写在回复里。\n收到的 QQ 内置表情会尽量从本机 QQ 缓存读取为真实图片交给视觉模型；收到的商城表情若带有真实图片也会保留。需要自然地用表情回应时，使用 qq_send_face（内置表情）或 qq_send_mface（有完整商城表情字段时），不要猜测缺失的商城 ID。\nQQ 渠道不提供 WebUI 弹窗。需要用户选择或补充信息时，把问题和清晰的编号选项作为普通文本发到 QQ，然后结束本轮；用户的下一条 QQ 消息会继续当前任务。不要调用 ask_user_question。",
    },
  ]);
});

test("preset setup mounts the optional local identity skill", async () => {
  const root = await mkdtemp(join(tmpdir(), "qq-gateway-identity-"));
  try {
    const identityFile = join(root, "SKILL.md");
    await writeFile(identityFile, "你是正在使用这台电脑的本地助理", "utf8");
    const sections = [];
    const gateway = new DshTaskGateway({
      ctx: { agentPresets: { mount: async () => undefined } },
      workspacePath: "/project/qq-workspace",
      identityFile,
      stateStore: { load: async () => ({ sessions: {} }), save: async () => undefined },
    });

    await gateway.presetComposition("router-auto").setup({
      systemPrompt: { section: (value) => sections.push(value) },
    });

    assert.deepEqual(sections.at(-1), {
      name: "qq-channel:identity",
      order: 8,
      text: "你是正在使用这台电脑的本地助理",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preset setup fixes the vision model and max reasoning for the QQ agent", async () => {
  const handlers = {};
  const gateway = new DshTaskGateway({
    ctx: { agentPresets: { mount: async () => undefined } },
    workspacePath: "/project/qq-workspace",
    agentProvider: "deepseek-official",
    agentModel: "deepseek-v4-flash-vision-exp",
    agentReasoningEffort: "max",
    stateStore: { load: async () => ({ sessions: {} }), save: async () => undefined },
  });

  await gateway.presetComposition("router-auto").setup({
    on: (name, callback) => {
      handlers[name] = callback;
      return () => undefined;
    },
  });
  const assembled = await handlers["system-prompt/assemble"]({}, {}, async () => ({ variables: {} }));
  assert.deepEqual(assembled.variables, {
    provider: "deepseek-official",
    model: "deepseek-v4-flash-vision-exp",
  });
  const request = await handlers["agent/request"]({}, async () => ({
    provider: "old-provider",
    model: "old-model",
    reasoningEffort: "low",
  }));
  assert.deepEqual(request, {
    provider: "deepseek-official",
    model: "deepseek-v4-flash-vision-exp",
    reasoningEffort: "max",
  });
});

test("DshTaskGateway creates one isolated workspace session and reuses it", async () => {
  const attached = [];
  const created = [];
  const saved = [];
  const live = new Map();
  const workspace = {
    id: "workspace-1",
    attachSession: async (id) => { attached.push(id); },
  };
  const ctx = {
    workspaceRegistry: { create: async () => workspace },
    sessionPersistence: { list: async () => [] },
    agentPresets: { defaultId: "router-auto", mount: async () => ({ id: "router-auto" }) },
    agents: {
      get: (id) => live.get(id),
      create: async (options) => {
        created.push(options);
        const agent = fakeAgent(options.sessionId);
        live.set(options.sessionId, agent);
        return { agent, dispose: async () => live.delete(options.sessionId) };
      },
      resume: async () => { throw new Error("unexpected resume"); },
    },
  };
  const stateStore = {
    load: async () => ({ sessions: {} }),
    save: async (state) => { saved.push(structuredClone(state)); },
  };
  const gateway = new DshTaskGateway({
    ctx,
    workspacePath: "/project/qq-workspace",
    workspaceTitle: "QQ 渠道",
    stateStore,
    ensureDirectory: async () => undefined,
    createMessage: ({ content, source }) => ({ id: "message-1", role: "user", content, source }),
    createSessionId: () => "session-qq-10001-abc",
  });

  await gateway.start();
  assert.equal(await gateway.dispatch("10001", "整理资料"), "任务已完成");
  assert.equal(await gateway.dispatch("10001", "继续"), "任务已完成");

  assert.equal(created.length, 1);
  assert.equal(created[0].meta.cwd, "/project/qq-workspace");
  assert.equal(created[0].meta.agentPreset, "router-auto");
  assert.deepEqual(attached, ["session-qq-10001-abc"]);
  assert.equal(saved.at(-1).sessions["10001"], "session-qq-10001-abc");
});

test("DshTaskGateway runs different contacts in parallel with isolated sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "qq-gateway-multi-contact-"));
  const deferred = () => {
    let resolve;
    const promise = new Promise((fulfill) => { resolve = fulfill; });
    return { promise, resolve };
  };
  const started = new Map([
    ["10001", deferred()],
    ["10002", deferred()],
  ]);
  const gates = new Map([
    ["10001", deferred()],
    ["10002", deferred()],
  ]);
  const live = new Map();
  const created = [];
  const attached = [];
  const events = [];
  let first;
  let second;
  const ctx = {
    workspaceRegistry: {
      create: async () => ({ attachSession: async (sessionId) => attached.push(sessionId) }),
    },
    sessionPersistence: { list: async () => [] },
    agentPresets: { defaultId: "router-auto", mount: async () => undefined },
    agents: {
      get: (sessionId) => live.get(sessionId),
      create: async (options) => {
        const contactId = String(options.sessionId).slice("session-".length);
        const messages = [];
        const agent = {
          id: options.sessionId,
          status: "idle",
          session: { deriveMessages: () => [...messages] },
          followup(message) {
            events.push(`${contactId}:started`);
            messages.push(message);
            started.get(contactId)?.resolve();
          },
          whenIdle: async () => {
            await gates.get(contactId).promise;
            messages.push({ role: "assistant", content: [{ type: "text", text: `done ${contactId}` }] });
          },
        };
        live.set(options.sessionId, agent);
        created.push(options);
        return { agent, dispose: async () => live.delete(options.sessionId) };
      },
      resume: async () => { throw new Error("unexpected resume"); },
    },
  };
  const gateway = new DshTaskGateway({
    ctx,
    workspacePath: join(root, "workspace"),
    corpusPath: join(root, "corpus"),
    stateStore: { load: async () => ({ sessions: {} }), save: async () => undefined },
    createSessionId: (senderId) => `session-${senderId}`,
    createMessage: ({ content, source }) => ({ role: "user", content, source }),
  });

  try {
    await gateway.start();
    first = gateway.dispatch("10001", "from A", { parts: [{ type: "text", text: "from A" }] });
    await started.get("10001").promise;
    second = gateway.dispatch("10002", "from B", { parts: [{ type: "text", text: "from B" }] });
    await started.get("10002").promise;

    assert.deepEqual(events, ["10001:started", "10002:started"]);
    assert.equal(gateway.activeRuns.get("10001").agent, live.get("session-10001"));
    assert.equal(gateway.activeRuns.get("10002").agent, live.get("session-10002"));
    assert.notEqual(gateway.state.sessions["10001"], gateway.state.sessions["10002"]);
    assert.deepEqual(attached.sort(), ["session-10001", "session-10002"]);

    gates.get("10002").resolve();
    assert.equal(await second, "done 10002");
    assert.equal(gateway.activeRuns.has("10001"), true);
    gates.get("10001").resolve();
    assert.equal(await first, "done 10001");
    assert.equal(gateway.activeRuns.size, 0);
    assert.deepEqual(created.map((options) => options.sessionId).sort(), ["session-10001", "session-10002"]);
  } finally {
    gates.get("10001").resolve();
    gates.get("10002").resolve();
    await Promise.allSettled([first, second].filter(Boolean));
    await gateway.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("DshTaskGateway resumes a persisted contact session", async () => {
  const resumed = [];
  const agent = fakeAgent("session-qq-old");
  const ctx = {
    workspaceRegistry: { create: async () => ({ attachSession: async () => undefined }) },
    sessionPersistence: { list: async () => [{ id: "session-qq-old" }] },
    agentPresets: { defaultId: "router-auto", mount: async () => ({ id: "router-auto" }) },
    agents: {
      get: () => undefined,
      create: async () => { throw new Error("unexpected create"); },
      resume: async (options) => {
        resumed.push(options);
        return { agent, dispose: async () => undefined };
      },
    },
  };
  const gateway = new DshTaskGateway({
    ctx,
    workspacePath: "/project/qq-workspace",
    stateStore: { load: async () => ({ sessions: { "10001": "session-qq-old" } }), save: async () => undefined },
    ensureDirectory: async () => undefined,
    createMessage: ({ content, source }) => ({ id: "message-2", role: "user", content, source }),
  });

  await gateway.start();
  await gateway.dispatch("10001", "接着做");
  assert.equal(resumed[0].resumeSessionId, "session-qq-old");
});

test("DshTaskGateway preserves an old session and creates a replacement when its preset disappeared", async () => {
  const created = [];
  const saved = [];
  let resumeCalls = 0;
  const agent = fakeAgent("session-qq-new");
  const ctx = {
    workspaceRegistry: { create: async () => ({ attachSession: async () => undefined }) },
    sessionPersistence: {
      list: async () => [{ id: "session-qq-old", agentPreset: "router-auto" }],
    },
    agentPresets: {
      defaultId: "standard",
      list: async () => [{ id: "standard" }, { id: "minimal" }],
      mount: async () => undefined,
    },
    agents: {
      get: () => undefined,
      create: async (options) => {
        created.push(options);
        return { agent, dispose: async () => undefined };
      },
      resume: async () => {
        resumeCalls += 1;
        throw new Error("an unavailable preset must not be resumed");
      },
    },
  };
  const gateway = new DshTaskGateway({
    ctx,
    workspacePath: "/project/qq-workspace",
    agentPreset: "router-auto",
    fallbackAgentPresets: ["router-standard", "standard", "minimal"],
    stateStore: {
      load: async () => ({ sessions: { "10001": "session-qq-old" } }),
      save: async (state) => saved.push(structuredClone(state)),
    },
    ensureDirectory: async () => undefined,
    createMessage: ({ content, source }) => ({ id: "message-migrate", role: "user", content, source }),
    createSessionId: () => "session-qq-new",
  });

  await gateway.start();
  assert.equal(await gateway.dispatch("10001", "继续处理"), "任务已完成");

  assert.equal(resumeCalls, 0);
  assert.equal(created.length, 1);
  assert.equal(created[0].meta.agentPreset, "standard");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].sessions["10001"], "session-qq-new");
});

test("DshTaskGateway keeps the old contact mapping when replacement session creation fails", async () => {
  const saved = [];
  const gateway = new DshTaskGateway({
    ctx: {
      workspaceRegistry: { create: async () => ({ attachSession: async () => undefined }) },
      sessionPersistence: { list: async () => [{ id: "session-qq-old", agentPreset: "router-auto" }] },
      agentPresets: {
        defaultId: "standard",
        list: async () => [{ id: "standard" }],
        mount: async () => undefined,
      },
      agents: {
        get: () => undefined,
        resume: async () => { throw new Error("unexpected resume"); },
        create: async () => { throw new Error("create failed"); },
      },
    },
    workspacePath: "/project/qq-workspace",
    agentPreset: "router-auto",
    fallbackAgentPresets: ["router-standard", "standard", "minimal"],
    stateStore: {
      load: async () => ({ sessions: { "10001": "session-qq-old" } }),
      save: async (state) => saved.push(structuredClone(state)),
    },
    ensureDirectory: async () => undefined,
    createMessage: ({ content, source }) => ({ id: "message-failed-migrate", role: "user", content, source }),
    createSessionId: () => "session-qq-new",
  });

  await gateway.start();
  await assert.rejects(gateway.dispatch("10001", "继续处理"), /create failed/);

  assert.equal(gateway.state.sessions["10001"], "session-qq-old");
  assert.equal(saved.length, 0);
});

function historyTestGateway({ headers, inspections = {}, current = "session-qq-10001-current", live = new Map(), saved = [], save }) {
  const disposed = [];
  const resumed = [];
  const gateway = new DshTaskGateway({
    ctx: {
      workspaceRegistry: { create: async () => ({ attachSession: async () => undefined }) },
      sessionPersistence: {
        list: async () => headers,
        inspect: async (id) => inspections[id] ?? { meta: headers.find((header) => header.id === id), events: [] },
      },
      agentPresets: { defaultId: "router-auto", mount: async () => undefined },
      agents: {
        get: (id) => live.get(id),
        resume: async (options) => {
          resumed.push(options.resumeSessionId);
          return { agent: { id: options.resumeSessionId, status: "idle" }, dispose: async () => undefined };
        },
      },
    },
    workspacePath: "/project/qq-workspace",
    stateStore: {
      load: async () => ({ sessions: { "10001": current } }),
      save: save ?? (async (state) => saved.push(structuredClone(state))),
    },
    ensureDirectory: async () => undefined,
  });
  gateway.trackDisposableForTest = (sessionId) => {
    gateway.handles.set(sessionId, {
      dispose: async () => disposed.push(sessionId),
    });
  };
  return { gateway, disposed, resumed };
}

test("DshTaskGateway lists only the contact's newest ten top-level QQ sessions", async () => {
  const valid = Array.from({ length: 12 }, (_, index) => ({
    version: 0,
    id: `session-qq-10001-${index}`,
    createdAt: 1000 + index,
    cwd: "/project/qq-workspace",
  }));
  const headers = [
    ...valid,
    { version: 0, id: "session-qq-10002-foreign", createdAt: 9999, cwd: "/project/qq-workspace" },
    { version: 0, id: "session-qq-10001-wrong-cwd", createdAt: 9998, cwd: "/project/elsewhere" },
    { version: 0, id: "session-qq-10001-child", createdAt: 9997, cwd: "/project/qq-workspace", origin: "subagent" },
  ];
  const inspections = Object.fromEntries(valid.map((header, index) => [header.id, {
    meta: header,
    events: [{ seq: 0, type: "user/message", data: { role: "user", content: [{ type: "text", text: `话题 ${index}` }], source: { kind: "user" } } }],
  }]));
  inspections["session-qq-10001-11"].events.push({ seq: 1, type: "session/title", data: { title: "最新标题" } });
  const { gateway } = historyTestGateway({ headers, inspections, current: "session-qq-10001-11" });
  await gateway.start();

  const text = await gateway.historyText("10001");

  assert.match(text, /1\. \[当前\] 最新标题/);
  assert.match(text, /10\. 话题 2/);
  assert.doesNotMatch(text, /话题 1\b|话题 0\b|10002|wrong-cwd|child/);
  assert.deepEqual(gateway.historySelections.get("10001"), valid.slice(2).reverse().map((header) => header.id));
});

test("DshTaskGateway history titles fall back from latest title to first user text to session tail", async () => {
  const headers = [
    { version: 0, id: "session-qq-10001-titled", createdAt: 3, cwd: "/project/qq-workspace" },
    { version: 0, id: "session-qq-10001-prompted", createdAt: 2, cwd: "/project/qq-workspace" },
    { version: 0, id: "session-qq-10001-abcdef123456", createdAt: 1, cwd: "/project/qq-workspace" },
  ];
  const inspections = {
    "session-qq-10001-titled": { meta: headers[0], events: [
      { seq: 0, type: "session/title", data: { title: "旧标题" } },
      { seq: 1, type: "session/title", data: { title: "新标题" } },
    ] },
    "session-qq-10001-prompted": { meta: headers[1], events: [
      { seq: 0, type: "user/message", data: { role: "user", content: [{ type: "text", text: "第一条用户消息很长，但仍可作为标题" }], source: { kind: "user" } } },
    ] },
    "session-qq-10001-abcdef123456": { meta: headers[2], events: [] },
  };
  const { gateway } = historyTestGateway({ headers, inspections, current: headers[0].id });
  await gateway.start();

  const text = await gateway.historyText("10001");

  assert.match(text, /新标题/);
  assert.match(text, /第一条用户消息很长/);
  assert.match(text, /…123456|abcdef123456/);
  assert.doesNotMatch(text, /旧标题/);
});

test("DshTaskGateway switches by the latest history index and disposes the idle owned handle", async () => {
  const headers = [
    { version: 0, id: "session-qq-10001-current", createdAt: 1, cwd: "/project/qq-workspace" },
    { version: 0, id: "session-qq-10001-target", createdAt: 2, cwd: "/project/qq-workspace" },
  ];
  const saved = [];
  const { gateway, disposed, resumed } = historyTestGateway({ headers, saved });
  await gateway.start();
  gateway.trackDisposableForTest("session-qq-10001-current");
  await gateway.historyText("10001");

  const result = await gateway.switchSession("10001", "1");

  assert.match(result, /已切换/);
  assert.match(result, /session-qq-10001-target/);
  assert.equal(gateway.state.sessions["10001"], "session-qq-10001-target");
  assert.equal(saved.at(-1).sessions["10001"], "session-qq-10001-target");
  assert.deepEqual(disposed, ["session-qq-10001-current"]);
  assert.equal(gateway.handles.has("session-qq-10001-current"), false);
  assert.deepEqual(resumed, []);

  const agent = await gateway.ensureAgent("10001");
  assert.equal(agent.id, "session-qq-10001-target");
  assert.deepEqual(resumed, ["session-qq-10001-target"]);
});

test("DshTaskGateway validates full session ids and leaves the mapping unchanged on errors", async () => {
  const headers = [
    { version: 0, id: "session-qq-10001-current", createdAt: 3, cwd: "/project/qq-workspace" },
    { version: 0, id: "session-qq-10001-target", createdAt: 2, cwd: "/project/qq-workspace" },
    { version: 0, id: "session-qq-10002-foreign", createdAt: 1, cwd: "/project/qq-workspace" },
  ];
  const { gateway } = historyTestGateway({ headers });
  await gateway.start();

  assert.match(await gateway.switchSession("10001", ""), /用法/);
  assert.match(await gateway.switchSession("10001", "2"), /先发送 \/历史/);
  await gateway.historyText("10001");
  assert.match(await gateway.switchSession("10001", "99"), /超出范围/);
  assert.match(await gateway.switchSession("10001", "session-qq-10002-foreign"), /不属于当前联系人/);
  assert.match(await gateway.switchSession("10001", "session-qq-10001-missing"), /不存在/);
  assert.match(await gateway.switchSession("10001", "session-qq-10001-current"), /当前已经/);
  assert.equal(gateway.state.sessions["10001"], "session-qq-10001-current");

  const success = await gateway.switchSession("10001", "session-qq-10001-target");
  assert.match(success, /已切换/);
  assert.equal(gateway.state.sessions["10001"], "session-qq-10001-target");
});

test("DshTaskGateway rolls back an in-memory switch when state persistence fails", async () => {
  const headers = [
    { version: 0, id: "session-qq-10001-current", createdAt: 2, cwd: "/project/qq-workspace" },
    { version: 0, id: "session-qq-10001-target", createdAt: 1, cwd: "/project/qq-workspace" },
  ];
  const { gateway } = historyTestGateway({
    headers,
    save: async () => { throw new Error("disk full"); },
  });
  await gateway.start();

  const result = await gateway.switchSession("10001", "session-qq-10001-target");

  assert.match(result, /切换失败.*disk full/);
  assert.equal(gateway.state.sessions["10001"], "session-qq-10001-current");
});

test("DshTaskGateway refuses history switching while the contact has active work", async () => {
  const currentAgent = { id: "session-qq-10001-current", status: "running" };
  const headers = [
    { version: 0, id: "session-qq-10001-current", createdAt: 2, cwd: "/project/qq-workspace" },
    { version: 0, id: "session-qq-10001-target", createdAt: 1, cwd: "/project/qq-workspace" },
  ];
  const { gateway } = historyTestGateway({ headers, live: new Map([[currentAgent.id, currentAgent]]) });
  await gateway.start();

  const result = await gateway.switchSession("10001", "session-qq-10001-target");

  assert.match(result, /正在工作|任务结束/);
  assert.equal(gateway.state.sessions["10001"], "session-qq-10001-current");
});

test("DshTaskGateway appends both sides to the live dialogue corpus", async () => {
  const root = await mkdtemp(join(tmpdir(), "qq-gateway-corpus-"));
  try {
    const live = new Map();
    const ctx = {
      workspaceRegistry: { create: async () => ({ attachSession: async () => undefined }) },
      sessionPersistence: { list: async () => [] },
      agentPresets: { defaultId: "router-auto", mount: async () => ({ id: "router-auto" }) },
      agents: {
        get: (id) => live.get(id),
        create: async (options) => {
          const agent = fakeAgent(options.sessionId);
          live.set(options.sessionId, agent);
          return { agent, dispose: async () => live.delete(options.sessionId) };
        },
        resume: async () => { throw new Error("unexpected resume"); },
      },
    };
    const gateway = new DshTaskGateway({
      ctx,
      workspacePath: join(root, "workspace"),
      corpusPath: join(root, "corpus"),
      stateStore: { load: async () => ({ sessions: {} }), save: async () => undefined },
      createMessage: ({ content, source }) => ({ id: "message-live", role: "user", content, source }),
      createSessionId: () => "session-live",
    });

    await gateway.start();
    await gateway.dispatch("10001", "整理", {
      messageId: "qq-1",
      parts: [{ type: "text", text: "整理" }],
      attachments: [],
    });

    const path = join(root, "corpus", "10001", "dialogue.jsonl");
    const records = (await readFile(path, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(records.length, 2);
    assert.equal(records[0].direction, "in");
    assert.equal(records[0].id, "in-qq-1");
    assert.equal(records[1].direction, "out");
    assert.equal(records[1].speaker, "owner");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("DshTaskGateway steers a message into an active task", async () => {
  const steered = [];
  const agent = {
    status: "running",
    session: { deriveMessages: () => [] },
    steer: (message) => steered.push(message),
  };
  const gateway = new DshTaskGateway({
    ctx: { agents: { get: () => agent } },
    workspacePath: "/project/qq-workspace",
    stateStore: { load: async () => ({ sessions: {} }), save: async () => undefined },
    ensureDirectory: async () => undefined,
    createMessage: ({ content, source }) => ({ content, source }),
  });
  gateway.state.sessions["10001"] = "session-live";

  const result = await gateway.dispatch("10001", "补充一个要求", {
    messageId: "qq-steer-1",
    parts: [{ type: "text", text: "补充一个要求" }],
    attachments: [],
  });

  assert.equal(result, "已把这条消息插入当前任务，当前任务完成后会继续回复。");
  assert.equal(steered.length, 1);
  assert.deepEqual(steered[0].content, [{ type: "text", text: "补充一个要求" }]);
});

test("DshTaskGateway does not start two ordinary turns for simultaneous messages", async () => {
  const started = [];
  const steered = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const agent = {
    status: "idle",
    session: { deriveMessages: () => [] },
    followup: () => {
      started.push(true);
      agent.status = "running";
    },
    steer: (message) => steered.push(message),
    whenIdle: async () => {
      await gate;
      agent.status = "idle";
    },
  };
  const gateway = new DshTaskGateway({
    ctx: { agents: { get: () => agent } },
    workspacePath: "/project/qq-workspace",
    stateStore: { load: async () => ({ sessions: {} }), save: async () => undefined },
    ensureDirectory: async () => undefined,
    createMessage: ({ content, source }) => ({ content, source }),
  });
  gateway.state.sessions["10001"] = "session-live";

  const first = gateway.dispatch("10001", "长任务", { parts: [{ type: "text", text: "长任务" }] });
  await new Promise((resolve) => setImmediate(resolve));
  const second = gateway.dispatch("10001", "中途补充", { parts: [{ type: "text", text: "中途补充" }] });
  assert.equal(await second, "已把这条消息插入当前任务，当前任务完成后会继续回复。");
  assert.equal(started.length, 1);
  assert.equal(steered.length, 1);

  release();
  await first;
});

test("DshTaskGateway steers before an async driver status flips to running", async () => {
  const started = [];
  const steered = [];
  let releaseIdle;
  const idleGate = new Promise((resolve) => { releaseIdle = resolve; });
  let releaseFollowup;
  const followupGate = new Promise((resolve) => { releaseFollowup = resolve; });
  const agent = {
    status: "idle",
    session: { deriveMessages: () => [] },
    followup: () => {
      started.push(true);
      releaseFollowup();
    },
    steer: (message) => steered.push(message),
    whenIdle: async () => {
      await idleGate;
      agent.status = "idle";
    },
  };
  const gateway = new DshTaskGateway({
    ctx: { agents: { get: () => agent } },
    workspacePath: "/project/qq-workspace",
    stateStore: { load: async () => ({ sessions: {} }), save: async () => undefined },
    ensureDirectory: async () => undefined,
    createMessage: ({ content, source }) => ({ content, source }),
  });
  gateway.state.sessions["10001"] = "session-live";

  const first = gateway.dispatch("10001", "异步启动", { parts: [{ type: "text", text: "异步启动" }] });
  await followupGate;
  const second = gateway.dispatch("10001", "立刻插话", { parts: [{ type: "text", text: "立刻插话" }] });
  assert.equal(await second, "已把这条消息插入当前任务，当前任务完成后会继续回复。");
  assert.equal(started.length, 1);
  assert.equal(steered.length, 1);

  releaseIdle();
  await first;
});

test("DshTaskGateway waits for finalization after the agent becomes idle", async () => {
  const started = [];
  let release;
  const finalization = new Promise((resolve) => { release = resolve; });
  const agent = {
    status: "idle",
    session: { deriveMessages: () => [] },
    followup: () => started.push(true),
    whenIdle: async () => undefined,
  };
  const gateway = new DshTaskGateway({
    ctx: { agents: { get: () => agent } },
    workspacePath: "/project/qq-workspace",
    stateStore: { load: async () => ({ sessions: {} }), save: async () => undefined },
    createMessage: ({ content, source }) => ({ content, source }),
  });
  gateway.state.sessions["10001"] = "session-live";
  gateway.activeRuns.set("10001", { agent, driverIdle: true, idleReached: false, promise: finalization });

  const pending = gateway.dispatch("10001", "收尾后再做");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, 0);
  release();
  assert.equal(await pending, "");
  assert.equal(started.length, 1);
});

test("DshTaskGateway keeps an idle agent occupied while outbound delivery finishes", async () => {
  const started = [];
  let releaseSend;
  const sendGate = new Promise((resolve) => { releaseSend = resolve; });
  const messages = [];
  const agent = {
    status: "idle",
    session: { deriveMessages: () => [...messages] },
    followup: (message) => {
      started.push(true);
      messages.push(message);
      messages.push({
        role: "assistant",
        content: [{
          type: "image",
          attachment: { attachmentId: "sha256:generated", mediaType: "image/png", name: "generated.png" },
        }],
      });
    },
    whenIdle: async () => undefined,
  };
  const gateway = new DshTaskGateway({
    ctx: { agents: { get: () => agent } },
    workspacePath: "/project/qq-workspace",
    stateStore: { load: async () => ({ sessions: {} }), save: async () => undefined },
    createMessage: ({ content, source }) => ({ content, source }),
    sendPrivateMessage: async () => sendGate,
  });
  gateway.appendConversationRecord = async () => undefined;
  gateway.state.sessions["10001"] = "session-live";
  gateway.attachments = {
    readImage: async (ref) => ({ ref, data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }),
  };

  let releaseStarted;
  const startedGate = new Promise((resolve) => { releaseStarted = resolve; });
  const originalFollowup = agent.followup;
  agent.followup = (message) => {
    originalFollowup(message);
    releaseStarted();
  };
  const first = gateway.dispatch("10001", "生成图");
  await startedGate;
  const second = gateway.dispatch("10001", "接着做");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, 1);
  releaseSend();
  await Promise.all([first, second]);
  assert.equal(started.length, 2);
});

test("DshTaskGateway preserves a received image as a native ImageBlock", async () => {
  const saved = [];
  const gateway = new DshTaskGateway({
    ctx: {},
    workspacePath: "/project/qq-workspace",
    attachments: {
      saveImage: async (input) => {
        saved.push(input);
        return {
          attachmentId: "sha256:test-image",
          mediaType: input.mediaType,
          bytes: input.data.byteLength,
          width: 1,
          height: 1,
          name: input.name,
        };
      },
    },
    stateStore: { load: async () => ({ sessions: {} }), save: async () => undefined },
  });

  const content = await gateway.prepareContent("10001", "看图", {
    parts: [
      { type: "text", text: "看图" },
      { type: "image", text: "[图片]", attachment: { file: "data:image/png;base64,iVBORw0KGgo=" } },
    ],
  });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].mediaType, "image/png");
  assert.deepEqual(content[0], { type: "text", text: "看图" });
  assert.equal(content[1].type, "text");
  assert.match(content[1].text, /attachment_id=sha256:test-image/);
  assert.deepEqual(content[2], {
    type: "image",
    attachment: {
      attachmentId: "sha256:test-image",
      mediaType: "image/png",
      bytes: 8,
      width: 1,
      height: 1,
      name: "qq-image",
    },
  });
});

test("DshTaskGateway resolves cached QQ face and market-face images", async () => {
  const root = await mkdtemp(join(tmpdir(), "qq-gateway-emoji-"));
  try {
    const facePath = join(root, "BaseEmojiSyastems", "EmojiSystermResource", "14", "apng", "14.png");
    const marketPath = join(root, "marketface", "14", "27_aio.png");
    await mkdir(join(root, "BaseEmojiSyastems", "EmojiSystermResource", "14", "apng"), { recursive: true });
    await mkdir(join(root, "marketface", "14"), { recursive: true });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await writeFile(facePath, png);
    await writeFile(marketPath, png);
    const saved = [];
    const gateway = new DshTaskGateway({
      ctx: {},
      workspacePath: root,
      emojiRoot: root,
      botSelfId: "90000",
      attachments: {
        saveImage: async (input) => {
          saved.push(input);
          return { attachmentId: `emoji-${saved.length}`, mediaType: input.mediaType, name: input.name };
        },
      },
      stateStore: { load: async () => ({ sessions: {} }), save: async () => undefined },
    });

    const content = await gateway.prepareContent("10001", "", {
      parts: [
        { type: "face", faceId: "14", text: "[表情:14]" },
        { type: "mface", text: "[QQ 商城表情: 笑]", attachment: { emojiId: "27", emojiPackageId: "14" } },
      ],
    });

    assert.deepEqual(saved.map((item) => [item.name, item.mediaType]), [
      ["qq-face-14.png", "image/png"],
      ["qq-mface-27.png", "image/png"],
    ]);
    assert.deepEqual(content.filter((part) => part.type === "image").map((part) => part.attachment.name), [
      "qq-face-14.png",
      "qq-mface-27.png",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("DshTaskGateway scopes received image references to their contact", async () => {
  const gateway = new DshTaskGateway({
    ctx: {},
    workspacePath: "/project/qq-workspace",
    attachments: {
      saveImage: async (input) => ({
        attachmentId: "sha256:same-id",
        mediaType: input.mediaType,
        bytes: input.data.byteLength,
        width: 1,
        height: 1,
        name: input.name,
      }),
      readImage: async (ref) => ({ ref, data: new Uint8Array([1, 2, 3]) }),
    },
    stateStore: { load: async () => ({ sessions: {} }), save: async () => undefined },
  });

  const attachment = { file: "data:image/png;base64,iVBORw0KGgo=" };
  await gateway.saveImageAttachment("10001", attachment);
  await gateway.saveImageAttachment("10002", attachment);

  const first = await gateway.readOutboundImage({ attachment_id: "sha256:same-id" }, "10001");
  const second = await gateway.readOutboundImage({ attachment_id: "sha256:same-id" }, "10002");
  assert.equal(first.name, "qq-image");
  assert.equal(second.name, "qq-image");
  assert.notEqual(gateway.receivedImages.get("10001:sha256:same-id"), gateway.receivedImages.get("10002:sha256:same-id"));
  await assert.rejects(
    gateway.readOutboundImage({ attachment_id: "sha256:other-contact-only" }, "10002"),
    /找不到仍可发送的图片附件/,
  );
});

test("DshTaskGateway never turns an unavailable image into a placeholder", async () => {
  const gateway = new DshTaskGateway({
    ctx: {},
    workspacePath: "/project/qq-workspace",
    stateStore: { load: async () => ({ sessions: {} }), save: async () => undefined },
  });

  await assert.rejects(
    gateway.prepareContent("10001", "看图", {
      parts: [{ type: "image", text: "[图片]", attachment: { file: "cache.jpg" } }],
    }),
    /未挂载图片附件存储/,
  );
});

test("DshTaskGateway can send a real workspace file through its scoped QQ tool", async () => {
  const root = await mkdtemp(join(tmpdir(), "qq-gateway-outbound-"));
  try {
    const path = join(root, "result.txt");
    await writeFile(path, "真实文件内容", "utf8");
    const registered = [];
    const sent = [];
    const gateway = new DshTaskGateway({
      ctx: {},
      workspacePath: root,
      sendPrivateMessage: async (senderId, message) => { sent.push([senderId, message]); },
      stateStore: { load: async () => ({ sessions: {} }), save: async () => undefined },
    });
    gateway.registerOutboundTools({ tools: { register: (definition) => { registered.push(definition); } } }, "10001");
    const fileTool = registered.find((definition) => definition.name === "qq_send_file");
    assert.ok(fileTool);
    const outcome = await fileTool.execute({ file_path: path }, {});
    assert.deepEqual(outcome, { sent: true, kind: "file", name: "result.txt" });
    assert.equal(sent[0][0], "10001");
    assert.equal(sent[0][1][0].type, "file");
    assert.match(sent[0][1][0].data.file, /^base64:\/\//);
    assert.equal(Buffer.from(sent[0][1][0].data.file.slice("base64://".length), "base64").toString(), "真实文件内容");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("DshTaskGateway sends native QQ face and market-face segments", async () => {
  const registered = [];
  const sent = [];
  const gateway = new DshTaskGateway({
    ctx: {},
    workspacePath: "/project/qq-workspace",
    sendPrivateMessage: async (senderId, message) => { sent.push([senderId, message]); },
    stateStore: { load: async () => ({ sessions: {} }), save: async () => undefined },
  });
  gateway.registerOutboundTools({ tools: { register: (definition) => registered.push(definition) } }, "10001");

  const faceTool = registered.find((definition) => definition.name === "qq_send_face");
  const marketTool = registered.find((definition) => definition.name === "qq_send_mface");
  assert.ok(faceTool);
  assert.ok(marketTool);
  assert.deepEqual(await faceTool.execute({ face_id: "14", caption: "看这个" }), {
    sent: true,
    kind: "face",
    name: "14",
  });
  assert.deepEqual(await marketTool.execute({
    emoji_id: "27",
    emoji_package_id: "14",
    key: "asset-key",
    summary: "笑",
  }), {
    sent: true,
    kind: "mface",
    name: "14/27",
  });
  assert.deepEqual(sent, [
    ["10001", [
      { type: "text", data: { text: "看这个" } },
      { type: "face", data: { id: "14" } },
    ]],
    ["10001", [{
      type: "mface",
      data: { emoji_id: "27", emoji_package_id: "14", key: "asset-key", summary: "笑" },
    }]],
  ]);
});

test("DshTaskGateway tries a later attachment reference when an earlier URL is unavailable", async () => {
  const gateway = new DshTaskGateway({
    ctx: {},
    workspacePath: "/project/qq-workspace",
    fetch: async () => ({ ok: false, status: 404 }),
    maxAttachmentBytes: 1024,
  });

  const downloaded = await gateway.downloadAttachment({
    url: "https://files.test/missing.png",
    base64: "data:image/png;base64,iVBORw0KGgo=",
  }, "image");
  assert.equal(downloaded.mediaType, "image/png");
  assert.equal(downloaded.data.byteLength, 8);
});

test("DshTaskGateway sends an image tool result as a real QQ image segment", async () => {
  const sent = [];
  const gateway = new DshTaskGateway({
    ctx: {},
    workspacePath: "/project/qq-workspace",
    attachments: {
      readImage: async (ref) => ({
        ref,
        data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      }),
    },
    sendPrivateMessage: async (senderId, message) => sent.push([senderId, message]),
  });

  await gateway.collectOutbound("10001", [{
    role: "assistant",
    content: [{
      type: "image",
      attachment: { attachmentId: "sha256:generated", mediaType: "image/png", name: "generated.png" },
    }],
  }], 0);

  assert.equal(sent[0][0], "10001");
  assert.equal(sent[0][1][0].type, "image");
  assert.match(sent[0][1][0].data.file, /^base64:\/\//);
  assert.equal(Buffer.from(sent[0][1][0].data.file.slice("base64://".length), "base64").length, 8);
});
