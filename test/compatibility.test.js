import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createUserMessageCompat, installModelSelectionCompat } from "../lib/dsh-compat.js";
import { assessDshVersion } from "../scripts/check-dsh-version.mjs";

test("DSH compatibility metadata avoids installing a private copy of host APIs", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const peerNames = [
    "@deepseek-ai/cordis",
    "@deepseek-ai/dsh-agent",
    "@deepseek-ai/dsh-attachment",
    "@deepseek-ai/dsh-agent-presets",
    "@deepseek-ai/dsh-llm",
    "@deepseek-ai/dsh-session-persistence",
    "@deepseek-ai/dsh-workspace",
  ];

  for (const name of peerNames) {
    assert.match(pkg.peerDependencies[name], />=0\.1\.0-rc\.6|\^4\.0\.1/);
    assert.equal(pkg.peerDependenciesMeta[name]?.optional, true);
  }
});

test("message compatibility uses the host helper when present", () => {
  const expected = { role: "user", id: "host-id", content: [] };
  const actual = createUserMessageCompat({ content: [] }, {
    createUserMessage: () => expected,
  });
  assert.equal(actual, expected);
});

test("message compatibility supplies the stable message shape when a newer host moves the helper", () => {
  const actual = createUserMessageCompat({ content: [{ type: "text", text: "继续" }] }, {}, () => "compat-id");
  assert.deepEqual(actual, {
    content: [{ type: "text", text: "继续" }],
    role: "user",
    id: "compat-id",
  });
});

test("model selection compatibility degrades to agent creation options when helper is absent", async () => {
  assert.equal(await installModelSelectionCompat({}, { current: {} }, {}), false);
  let received;
  assert.equal(await installModelSelectionCompat("ctx", "selection", {
    installModelSelection: (...args) => { received = args; },
  }), true);
  assert.deepEqual(received, ["ctx", "selection"]);
});

test("DSH version assessment keeps compatible previews and rejects only the old floor", () => {
  assert.equal(assessDshVersion("0.1.0-rc.6").status, "supported");
  assert.equal(assessDshVersion("dsh 0.1.2-rc.1").status, "supported");
  assert.equal(assessDshVersion("0.1.5-alpha.1").status, "supported");
  assert.equal(assessDshVersion("0.1.0-rc.5").status, "too-old");
  assert.equal(assessDshVersion("0.1.0-alpha.5").status, "too-old");
  assert.equal(assessDshVersion("0.2.0").status, "future");
  assert.equal(assessDshVersion("source checkout").status, "unknown");
});
