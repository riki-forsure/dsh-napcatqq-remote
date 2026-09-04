import test from "node:test";
import assert from "node:assert/strict";

import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { Config, inject, loadLocalOverrides, name } from "../lib/index.js";

test("dsh plugin exports a validated Cordis entrypoint", () => {
  assert.equal(name, "qq-channel");
  assert.deepEqual(inject, ["agents", "sessionPersistence", "workspaceRegistry", "agentPresets", "attachments"]);
  assert.ok(Config);
});

test("loadLocalOverrides reads persistent QQ channel settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dsh-qq-channel-"));
  const path = join(directory, "config.json");
  await writeFile(path, JSON.stringify({
    allowedContacts: [10001, "10002"],
    websocketUrl: "ws://windows-host:3001",
    accessToken: "secret",
    stylePromptFile: "/project/style.md",
  }));

  assert.deepEqual(loadLocalOverrides(path), {
    allowedContacts: ["10001", "10002"],
    websocketUrl: "ws://windows-host:3001",
    accessToken: "secret",
    stylePromptFile: "/project/style.md",
  });
  assert.deepEqual(loadLocalOverrides(join(directory, "missing.json")), {});
});

test("loadLocalOverrides reads and normalizes the preset fallback chain", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dsh-qq-channel-presets-"));
  const path = join(directory, "config.json");
  await writeFile(path, JSON.stringify({
    agentPreset: " router-auto ",
    fallbackAgentPresets: ["router-standard", " standard ", "router-standard", "", 123],
  }));

  assert.deepEqual(loadLocalOverrides(path), {
    agentPreset: "router-auto",
    fallbackAgentPresets: ["router-standard", "standard"],
  });
});
