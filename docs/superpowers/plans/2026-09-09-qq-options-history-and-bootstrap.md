# QQ Options, History, and Windows Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DeepSeek Harness (DSH) QQ tasks expose choices as ordinary QQ messages, add contact-isolated conversation history switching, and provide a reliable Windows installer/launcher path for DSH, NapCatQQ, and OneBot 11.

**Architecture:** The channel parser owns user-facing commands, while `DshGateway` owns session validation, listing, switching, and DSH tool restrictions. Windows setup is implemented as idempotent PowerShell scripts with a shared helper module, detecting existing NapCat Shell or NapCat Desktop before installing the official Shell OneKey package. The live plugin is updated with the same focused code changes without replacing local configuration or persona files.

**Tech Stack:** Node.js ESM, `node:test`, DSH plugin APIs, PowerShell 5.1+, WSL2/Ubuntu, NapCatQQ Shell/Desktop, OneBot 11 WebSocket.

## Global Constraints

- [ ] Do not stop or restart the currently running DSH process.
- [ ] Never commit QQ numbers, OneBot tokens, local absolute user paths, or generated state.
- [ ] Preserve the installed plugin's local workspace, persona, emoji, and configuration customizations.
- [ ] Each behavioral change starts with a failing focused test, then the minimum implementation, then the full test suite.
- [ ] New Windows scripts must be idempotent and support temporary fixture directories for tests.

---

## Task 1: Convert DSH UI-only questions into QQ-visible choices

**Files:**
- Modify: `test/dsh-gateway.test.js`
- Modify: `lib/dsh-gateway.js`

- [ ] Add a test proving QQ-created agents call `agentCtx.tools.restrict({ deny: ["ask_user_question"] })` when available.
- [ ] Add a compatibility test proving agent creation still succeeds when `tools.restrict` is absent.
- [ ] Add assertions that the QQ system prompt asks the model to present numbered choices as normal text and end the turn for a later QQ reply.
- [ ] Run `pnpm test -- --test-name-pattern="ask_user_question|numbered choices"` and confirm the new tests fail for the expected missing behavior.
- [ ] Implement the restriction in the QQ agent preset setup and add the system-prompt fallback.
- [ ] Re-run the focused tests and confirm they pass.
- [ ] Commit as `feat: expose DSH choices in QQ`.

## Task 2: Add contact-isolated history and switching in the gateway

**Files:**
- Modify: `test/dsh-gateway.test.js`
- Modify: `lib/dsh-gateway.js`

- [ ] Add tests for listing the newest ten top-level `session-qq-<contact>-*` sessions in the QQ workspace, marking the current session and excluding other contacts, workspaces, and subagents.
- [ ] Add tests for title selection: latest `session/title`, first user text, then a shortened session ID.
- [ ] Add tests for switching by the most recent numeric list index and by full session ID.
- [ ] Add tests that missing history, out-of-range indices, foreign sessions, nonexistent sessions, and active runs leave the current mapping unchanged.
- [ ] Add a test that a successful switch persists state, disposes an idle plugin-owned handle, and lets the next message resume the chosen session.
- [ ] Run focused history tests and confirm the expected failures.
- [ ] Implement gateway history cache, session filtering/title extraction, formatted listing, validation, and atomic switching.
- [ ] Re-run focused tests and confirm they pass.
- [ ] Commit as `feat: add per-contact QQ session history`.

## Task 3: Expose history commands through QQ

**Files:**
- Modify: `test/channel.test.js`
- Modify: `lib/channel.js`
- Modify: `lib/index.js`

- [ ] Add failing parser tests for `/历史`, `/history`, `/切换 2`, `/switch 2`, full-ID switching, usage text, and preservation of ordinary messages.
- [ ] Add channel callbacks for history listing and session switching, returning all results through normal private QQ messages.
- [ ] Wire the callbacks to `DshGateway` in the plugin entry point.
- [ ] Run `pnpm test` and confirm all Node tests pass.
- [ ] Commit as `feat: add QQ history commands`.

## Task 4: Build the idempotent Windows full-stack installer and launchers

**Files:**
- Add: `scripts/windows/DshNapCat.Setup.psm1`
- Add: `scripts/windows/install-full-stack.ps1`
- Add: `scripts/windows/start-dsh-qq-bot.ps1`
- Add: `scripts/windows/open-napcat-manager.ps1`
- Add: `scripts/windows/tests/DshNapCat.Setup.Tests.ps1`

- [ ] Add fixture-based PowerShell tests for detecting existing NapCat Shell and Desktop installations, choosing Shell first when both exist, producing OneBot 11 WebSocket configuration without leaking the token, and creating the two required shortcut definitions.
- [ ] Run the PowerShell tests and confirm the helper functions are initially missing.
- [ ] Implement shared detection, GitHub-release resolution, OneKey download/extraction, WSL/DSH checks, configuration backup/write, loopback-only OneBot defaults, and shortcut creation helpers.
- [ ] Implement `install-full-stack.ps1` so a new machine is prepared through the QQ login screen, while an existing Shell/Desktop install is preserved and reused.
- [ ] Implement `start-dsh-qq-bot.ps1` so it starts/reuses NapCat, finalizes OneBot after login, starts only one DSH WebUI instance, and opens `http://127.0.0.1:3080/`.
- [ ] Implement `open-napcat-manager.ps1` so Shell and Desktop users reach the correct login/management UI.
- [ ] Re-run the PowerShell tests and a parse-only check for every script.
- [ ] Commit as `feat: add Windows full-stack bootstrap`.

## Task 5: Rewrite installation and usage documentation

**Files:**
- Modify: `README.md`
- Modify: `QUICKSTART.md`
- Modify: `INSTALLATION.md`
- Modify: `NAPCAT_SETUP.md`
- Modify: `AGENTS.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] Lead the README with implemented capabilities, then route readers to quick installation or the detailed tutorial.
- [ ] Clearly distinguish NapCatQQ Shell/OneKey from NapCatQQ Desktop and explain that their interfaces and configuration paths differ.
- [ ] Document the two desktop shortcuts, first-login boundary, local-only ports, OneBot 11 relationship, manual setup paths, and all QQ commands including history/switching.
- [ ] Make `AGENTS.md` directly executable by an installation agent: detection order, exact commands, noninteractive steps, login handoff, resume/finalization, validation, and secrets rules.
- [ ] Update version to `0.2.0`, lockfile metadata, and changelog.
- [ ] Search for stale Desktop-only instructions, placeholders, personal QQ numbers, tokens, and user-specific paths.
- [ ] Commit as `docs: add full-stack setup and history guide`.

## Task 6: Synchronize the installed plugin without restarting DSH

**Files:**
- Modify selectively: `/home/riki/.dsh/plugins/dsh-qq-channel/lib/dsh-gateway.js`
- Modify selectively: `/home/riki/.dsh/plugins/dsh-qq-channel/lib/channel.js`
- Modify selectively: `/home/riki/.dsh/plugins/dsh-qq-channel/lib/index.js`
- Modify selectively: `/home/riki/.dsh/plugins/dsh-qq-channel/package.json`

- [ ] Re-diff the public repository against the installed plugin immediately before editing.
- [ ] Apply only the option/history/runtime wiring changes and preserve all local-only persona, emoji, workspace, and configuration logic.
- [ ] Run the installed plugin's Node tests and syntax checks without loading it into the active DSH process.
- [ ] Confirm the active DSH PID and start time are unchanged.

## Task 7: Final verification and GitHub publication

**Files:**
- Verify all changed files

- [ ] Run the complete Node test suite from a clean command.
- [ ] Run all PowerShell tests and parser checks from a clean command.
- [ ] Run `git diff --check`, inspect `git diff --stat`, and verify `git status --short` contains only intended changes.
- [ ] Scan tracked files for local QQ identifiers, tokens, local persona content, and machine-specific absolute paths.
- [ ] Confirm DSH was not restarted and the current WebUI remains reachable.
- [ ] Commit any final integration fixes, tag `v0.2.0`, push `main`, push the tag, and create/update the GitHub release with concise notes.
- [ ] Report the repository URL, changed local plugin path, tests run, and the fact that a manual DSH restart is still required to activate the new plugin code.
