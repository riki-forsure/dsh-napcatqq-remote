# Agent installation contract

## Objective

When a user gives you this repository URL and asks you to install it, install `dsh-napcatqq-remote` as the `dsh-qq-channel` plugin for the user's DeepSeek Harness (`dsh`) `web` profile. Connect it to the user's NapCatQQ OneBot 11 WebSocket Server, preserve existing local state, and provide evidence for every validation result.

This file is the authoritative Agent entry point. Read it completely before making changes. Use these human guides as supporting references:

- `QUICKSTART.md`: dsh and NapCatQQ already work.
- `NAPCAT_SETUP.md`: dsh works but NapCatQQ is missing.
- `INSTALLATION.md`: WSL, Node.js, dsh, model, or NapCatQQ is missing.
- `README.md`: product behavior, QQ commands, limits, and component relationship.

## Component boundaries

```text
allow-listed contact
  -> robot QQ logged into NapCatQQ
  -> OneBot 11 WebSocket Server
  -> this plugin
  -> isolated QQ workspace/session in DeepSeek Harness
  -> configured model and tools
  -> this plugin
  -> NapCatQQ
  -> originating contact
```

- NapCatQQ is the QQ/OneBot bridge. It does not perform Agent work.
- This plugin handles allow-listing, message normalization, attachments, session mapping, task steering, and delivery back to QQ.
- DeepSeek Harness performs the actual model/tool/workspace work.
- `dsh-routing-suite` is an independent optional enhancement. Do not install it unless the user explicitly requests it; built-in `standard` and `minimal` fallbacks keep this plugin usable.

## Non-negotiable preservation rules

1. Inspect before writing. Do not assume Windows versus WSL, the dsh invocation, profile path, active process, or existing plugin source.
2. Preserve any existing `config.json`, `state.json`, contact style, session files, attachments, corpus, QQ workspace, dsh profile, model credentials, and NapCat configuration.
3. Before modifying an existing local config, create a timestamped backup beside it and report the backup path.
4. Do not delete or reset a session mapping merely because a test contact is absent. Mappings are created lazily after the first ordinary message.
5. Do not stop, restart, or start a second `dsh web` process unless the user has asked for the restart or accepts the announced impact. A configuration change takes effect only after one controlled restart.
6. Do not edit the user's live plugin source while another Agent is modifying it. Use a separate clone/worktree and merge only intentional changes.
7. Do not print OneBot tokens, model API keys, QQ login data, full private QQ numbers, chat content, or database keys. Redact secrets in logs and the final report.
8. Do not commit local `config.json`, `state.json`, `.qq-inbox`, corpus, contact style, database, Token, or real QQ account data to this repository.
9. Do not expose NapCat port 3001 or dsh WebUI port 3080 to the public Internet. Use loopback/local firewall scope; `0.0.0.0:3001` is only for local WSL-to-Windows reachability.

## Route selection

Choose exactly one route after discovery:

| Observed environment | Route |
| --- | --- |
| dsh ordinary WebUI conversation works and NapCat OneBot WS is reachable | Follow `QUICKSTART.md`. |
| dsh ordinary conversation works, but NapCat is absent or has no OneBot WS | Follow `NAPCAT_SETUP.md`, then `QUICKSTART.md`. |
| Node.js, WSL, dsh, model configuration, or ordinary dsh conversation is missing | Follow `INSTALLATION.md` from the first missing layer. |
| Plugin already exists | Audit source/version/config first; update in place without replacing user data. |

QQ login, QR/device verification, choosing the robot account, and supplying allow-listed contact QQ numbers are human steps. Continue with every safe automatable step, then hand off only those items.

## Phase 1: read-only discovery

Run checks appropriate to the host. Do not start or stop services during discovery.

### Repository and host

```bash
pwd
git status --short --branch 2>/dev/null || true
uname -a
command -v wslpath || true
```

When invoked from Windows, also inspect:

```powershell
wsl --status
wsl --list --verbose
Get-Process | Where-Object { $_.ProcessName -match 'NapCat|QQ|node' }
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 3001,3080 }
```

### Runtime and dsh

```bash
node -v || true
pnpm -v || true
git --version || true
command -v dsh || true
dsh --version 2>/dev/null || true
npx @deepseek-ai/dsh --version 2>/dev/null || true
ss -ltnp 2>/dev/null | grep -E ':(3001|3080)\b' || true
ps -ef | grep -E '[d]sh.*web|[@]deepseek-ai/dsh.*web' || true
```

Current DeepSeek Harness upstream runtime guidance is Node.js `^22.19.0` or `>=24.0.0`. The plugin package itself is JavaScript, but the actual host version must satisfy the dsh installation used by the user.

Identify the exact command the user already uses to run dsh. Do not switch an existing source checkout/global install to npx, or an existing npx workflow to another installation, without explaining the migration.

### Existing plugin and data

Respect `DSH_HOME` when set; otherwise the common home is `~/.dsh`.

```bash
printf 'DSH_HOME=%s\n' "${DSH_HOME:-$HOME/.dsh}"
test -d ~/.dsh/qq-channel && find ~/.dsh/qq-channel -maxdepth 1 -type f -printf '%f\n' || true
test -d ~/dsh-work/qq-channel-workspace && find ~/dsh-work/qq-channel-workspace -maxdepth 2 -type d -print || true
printenv | grep '^DSH_QQ_' | sed -E 's/(TOKEN|KEY)=.*/\1=[REDACTED]/' || true
dsh plugin --profile web why dsh-qq-channel 2>/dev/null || true
dsh --profile web --dump-config 2>/dev/null | grep -A 20 'qq-channel' || true
```

Do not include an unredacted dump-config block in the report because it may contain the OneBot token.

Record:

- host topology: Windows + WSL2, same-host Linux, or another arrangement;
- dsh invocation and version;
- active dsh process count and port 3080 owner;
- NapCat presence, robot online state if observable, OneBot WS host/port, and 3001 reachability;
- current plugin source/version and web profile membership;
- local config/state/style/workspace paths;
- whether `DSH_QQ_*` variables override JSON;
- model provider/model IDs available to the current dsh profile.

## Phase 2: obtain only required human values

The installation needs:

```text
CONTACT_QQ_1[, CONTACT_QQ_2...]  allow-listed senders
ONEBOT_WS_URL                     for example ws://172.20.0.1:3001
ONEBOT_ACCESS_TOKEN               empty only if NapCat also has no token
DSH_INVOCATION                    existing dsh command or npx invocation
```

Do not infer a contact QQ from the robot QQ. `allowedContacts` contains senders. Do not confuse the NapCat WebUI login token with the OneBot Access Token.

If NapCat is missing, install NapCatQQ Desktop from its official Releases page and leave QR/device verification to the user. Configure a OneBot 11 **WebSocket Server**, message format `array`, `reportSelfMessage` off, port 3001, and a matching Access Token. Use Host `0.0.0.0` only when WSL must reach the Windows host; otherwise prefer `127.0.0.1`.

## Phase 3: install or update the repository

Choose a dedicated source directory. The default below is acceptable only when it does not already contain unrelated data:

```bash
cd ~
git clone https://github.com/riki-forsure/dsh-napcatqq-remote.git dsh-qq-channel
cd ~/dsh-qq-channel
pnpm install --frozen-lockfile
pnpm test
```

If it already exists and its remote is this repository:

```bash
cd ~/dsh-qq-channel
git status --short --branch
git remote -v
git pull --ff-only
pnpm install --frozen-lockfile
pnpm test
```

If it has user changes, do not discard them. Report the diff and use a separate clone/worktree for the update.

The tests target the documented WSL/Linux runtime. Run them inside WSL/Linux, not with Windows Node against `/mnt/c` paths.

Add the local checkout to the same dsh installation the user already runs:

```bash
cd ~/dsh-qq-channel
dsh plugin --profile web add "$PWD"
```

If the user's established invocation is npx:

```bash
cd ~/dsh-qq-channel
npx @deepseek-ai/dsh plugin --profile web add "$PWD"
```

## Phase 4: create or merge configuration

Default local config path:

```text
~/.dsh/qq-channel/config.json
```

If the file exists, back it up before merging:

```bash
stamp=$(date +%Y%m%d-%H%M%S)
cp -a ~/.dsh/qq-channel/config.json ~/.dsh/qq-channel/config.json.backup-$stamp
```

For a new install:

```bash
mkdir -p ~/.dsh/qq-channel
cp ~/dsh-qq-channel/config.example.json ~/.dsh/qq-channel/config.json
```

Set the full schema, preserving existing values the user did not ask to change:

```json
{
  "allowedContacts": ["CONTACT_QQ_1", "CONTACT_QQ_2"],
  "websocketUrl": "ws://WINDOWS_HOST:3001",
  "accessToken": "ONEBOT_ACCESS_TOKEN_OR_EMPTY",
  "stylePromptFile": "",
  "emojiRoot": "",
  "botSelfId": "",
  "agentPreset": "router-auto",
  "fallbackAgentPresets": ["router-standard", "standard", "minimal"],
  "agentProvider": "deepseek-official",
  "agentModel": "deepseek-v4-flash-vision-exp",
  "agentReasoningEffort": "max",
  "maxAttachmentBytes": 52428800,
  "maxImageBytes": 20971520,
  "filePreviewBytes": 8192
}
```

Rules:

- Use strings for QQ numbers.
- `agentProvider` and `agentModel` must match IDs configured in the user's dsh WebUI; do not assume defaults are available.
- Keep `router-auto` as preferred and `router-standard`, `standard`, `minimal` as fallbacks unless the user requests a different chain.
- Leave `stylePromptFile` empty for the default dsh preset tone.
- To enable style, copy `contact-style.example.md` to `~/.dsh/qq-channel/contact-style.md`, edit the copy, and use its absolute path.
- Leave `emojiRoot` empty for auto-detection; set it only to an observed QQ NT data root.
- Environment variables override JSON. Merge or unset stale `DSH_QQ_*` variables rather than claiming the JSON change worked.

Validate JSON without printing secrets:

```bash
node -e "const p=process.env.HOME+'/.dsh/qq-channel/config.json'; const c=JSON.parse(require('fs').readFileSync(p,'utf8')); if(!Array.isArray(c.allowedContacts)||!c.allowedContacts.length) throw Error('allowedContacts is empty'); if(!String(c.websocketUrl||'').startsWith('ws')) throw Error('websocketUrl is invalid'); console.log('QQ config syntax and required fields OK')"
```

## Phase 5: non-disruptive validation

Before restart:

1. Confirm repository tests pass in WSL/Linux.
2. Confirm package version from `package.json`.
3. Confirm NapCat port is reachable from the dsh host.
4. Run the established dsh invocation with `--profile web --dump-config` and confirm `qq-channel` exists.
5. Confirm the final workspace is `~/dsh-work/qq-channel-workspace` unless the user customized it.
6. Confirm only one existing WebUI process owns port 3080.

Example port check for WSL, with the observed Windows IP substituted:

```bash
timeout 3 bash -c '</dev/tcp/WINDOWS_HOST/3001' && echo REACHABLE || echo UNREACHABLE
```

Do not fake a QQ end-to-end result. `/状态` and an ordinary private message must be sent by a real allow-listed contact after the user has logged in.

## Phase 6: controlled restart and end-to-end acceptance

Explain that the plugin reads config at dsh startup. If the user authorizes or requested completion, stop the single identified dsh WebUI cleanly and restart it once with its existing invocation. Never launch a second instance to test browser opening.

Ask the user to send from an allow-listed contact:

```text
/状态
```

Expected: OneBot connection, QQ workspace, allow-list count, style state, actual Agent preset, vision model, and reasoning effort.

Then ask for an ordinary task:

```text
在 QQ 渠道工作区新建 hello.txt，内容写“连接成功”，然后把文件发回给我。
```

Expected:

- the first ordinary message lazily creates a contact session;
- the file is created and delivered through `qq_send_file`;
- a second message during execution steers the same task;
- `/新任务` clears the mapping and the next ordinary message creates a new session;
- the previous session remains visible in dsh WebUI.

## Required final report

Report all of the following, with secrets and private QQ digits redacted:

```text
Installation source and commit/tag:
Plugin package version:
dsh invocation, version, and profile:
Node and pnpm versions:
Repository test result:
Plugin/profile composition result:
Config path and backup path:
QQ workspace and state path:
NapCat OneBot endpoint reachability:
Preferred and actual Agent preset:
Model provider/model configured:
dsh process count before/after:
/状态 result:
Ordinary task/file-return result:
Manual steps still required:
```

Never replace evidence with a bare “installed successfully.” Clearly label checks that require the user and have not yet been performed.

## Runtime behavior to preserve in documentation and tests

- Commands: `/状态`, `/status`, `/新任务`, `/new`.
- `/状态` is local and does not create a session.
- `/新任务` removes the current contact mapping; the next ordinary message creates a session.
- Same-contact messages reuse one session until reset.
- A message arriving during an active run steers that run instead of starting a second same-contact turn.
- Contacts are isolated from each other and may run concurrently.
- Files, images, built-in faces, and market faces are accepted; vision requires actual image bytes.
- Outbound tools are `qq_send_file`, `qq_send_image`, `qq_send_face`, and `qq_send_mface`.
- Default attachment limits are 50 MiB for ordinary files and 20 MiB for images.
