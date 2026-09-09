# Agent installation contract

## Objective

When a user gives you this repository URL and asks for installation, configure the complete Windows + WSL stack, not only the JavaScript package:

```text
robot QQ login in NapCatQQ
  -> OneBot 11 WebSocket Server
  -> dsh-qq-channel
  -> isolated QQ workspace and sessions
  -> DeepSeek Harness (DSH) model and tools
  -> reply to the originating allow-listed contact
```

Advance automatically until a human-only login or credential boundary. A successful handoff leaves the QQ login/device-verification interface visible and creates two working desktop shortcuts. Read this file completely before acting.

## Human-only boundaries

The Agent should perform discovery, downloads, installs, configuration, backups, shortcut creation, port checks, and local tests. Ask the user only for values or interactions that are genuinely unavailable:

- the QQ accounts that may send tasks (`allowedContacts`); these are senders, not the robot;
- QQ scan/password/device/risk verification for the robot account;
- a model API credential if DSH has no working provider yet.

After the user completes QQ login, resume and finish OneBot/plugin validation. Do not stop at “install the bot component yourself.”

## Preservation and privacy rules

1. Inspect before writing. Preserve existing DSH profiles, sessions, workspaces, model settings, plugin configuration, contact style, corpus, NapCat accounts, and OneBot endpoints.
2. Create timestamped backups before changing existing JSON configuration.
3. Never print or commit full QQ numbers, OneBot tokens, NapCat WebUI tokens, API keys, QR codes, chat records, `state.json`, or local absolute persona paths.
4. Do not launch a second DSH WebUI when port 3080 is already owned. Do not restart a running DSH merely to validate installation unless the user explicitly asks; report that activation awaits one controlled restart.
5. Bind DSH WebUI to `127.0.0.1`. Bind OneBot to the Windows address visible only through the local WSL path where possible; never publish 3001/3080 to the Internet.
6. Existing NapCat Shell and NapCat Desktop are different products/UI shapes. Detect the actual one and follow its branch; do not invent buttons from the other UI.
7. If the live plugin has local edits, work from a separate checkout and merge only intentional code/config changes.

## Preferred automated route

### 1. Read-only discovery

On Windows:

```powershell
wsl --status
wsl --list --verbose
Get-Process | Where-Object { $_.ProcessName -match 'NapCat|QQ|node' }
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in 3001,3080 }
Get-ChildItem $env:USERPROFILE\Desktop -Filter '*NapCat*.lnk' -ErrorAction SilentlyContinue
```

In WSL/Linux:

```bash
node -v || true
pnpm -v || true
git --version || true
command -v dsh || true
dsh --version 2>/dev/null || true
ss -ltnp 2>/dev/null | grep -E ':(3001|3080)\b' || true
ps -ef | grep -E '[d]sh.*web' || true
test -f ~/.dsh/qq-channel/config.json && echo 'QQ config exists' || true
dsh plugin --profile web why dsh-qq-channel 2>/dev/null || true
```

Do not include a raw `--dump-config` in reports because it can contain the OneBot token.

Identify NapCat by files/process paths:

- Shell/OneKey: `NapCatWinBootMain.exe` plus `napcat.bat`, `launcher-user.bat`, or `launcher.bat`; management is usually a browser WebUI and config is under the Shell directory.
- Desktop: an installed NapCatQQ Desktop manager and its Bot list; data commonly lives under `%ProgramData%\NapCatQQ Desktop`.

If both exist, preserve both and prefer an already running/configured Shell unless the user selected Desktop.

### 2. Run the repository installer

From a Windows checkout of this repository:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows\install-full-stack.ps1 -AllowedContacts 'CONTACT_QQ'
```

Multiple contacts:

```powershell
.\scripts\windows\install-full-stack.ps1 `
  -AllowedContacts 'CONTACT_QQ_1','CONTACT_QQ_2'
```

If discovery found a Shell root outside common locations, pass it explicitly:

```powershell
.\scripts\windows\install-full-stack.ps1 `
  -AllowedContacts 'CONTACT_QQ' `
  -NapCatRoot 'D:\Observed\NapCat.Shell'
```

The script is idempotent and is the preferred implementation of these actions:

- detect/reuse Shell or Desktop;
- install missing WSL Ubuntu, initialize a Linux user, Node.js 24, pnpm, Git, and DSH;
- preserve an existing compatible DSH; install `@deepseek-ai/dsh@latest` only when absent, and upgrade only when older than `0.1.0-rc.6`;
- install the latest official `NapCat.Shell.Windows.OneKey.zip` when NapCat is absent, then run its `NapCatInstaller.exe` deployment stage;
- install/update this repository into the same DSH `web` profile;
- detect missing `router-standard` and install `github:yjh051108/dsh-routing-suite`;
- keep `standard` and `minimal` as working fallbacks if the routing suite fails;
- protect the generated OneBot token with current-user DPAPI rather than placing it in shortcut arguments;
- create `启动 DSH QQ 机器人` and `NapCat 登录与管理` on the desktop.

The routing suite currently provides `router-standard`; `router-auto` may be a pre-existing custom preset. Preserve an existing configured preset. New generated configuration uses `router-standard`.

### 3. Handle first login, then resume

If the installer opens QQ/NapCat and reports that login is incomplete:

1. Leave the QQ login/device-verification interface visible.
2. Tell the user to complete that interaction and reply when logged in.
3. After confirmation, run the installed start shortcut or its script:

```powershell
& "$env:LOCALAPPDATA\DshNapCatQQ\bin\start-dsh-qq-bot.ps1"
```

For Shell/OneKey, the script detects the logged-in account, creates/updates `config\onebot11_<BOT_QQ>.json`, uses array messages, disables self messages, synchronizes the same access token into WSL, restarts NapCat only when its managed OneBot entry changed, starts at most one DSH, and opens the WebUI.

### 4. Existing Desktop branch

The shared script preserves Desktop but does not pretend that Desktop uses Shell JSON files. After QQ login, use the actual Desktop UI/API to complete the Bot's network page:

- enabled OneBot 11 WebSocket Server;
- Host reachable from WSL (or `127.0.0.1` under mirrored networking);
- Port `3001`;
- message format `array`;
- `reportSelfMessage` off;
- Access Token equal to the protected setup token.

Retrieve that token into an in-memory variable without printing it:

```powershell
Import-Module "$env:LOCALAPPDATA\DshNapCatQQ\bin\DshNapCat.Setup.psm1" -Force
$state = Read-DshNapCatState "$env:LOCALAPPDATA\DshNapCatQQ\setup.json"
$oneBotToken = Unprotect-SetupSecret $state.EncryptedAccessToken
```

Use UI automation when available, save the Desktop Bot, then clear the variable (`$oneBotToken = $null`) and run the start shortcut. If a Desktop version exposes different labels, locate the WebSocket Server fields by meaning, not by copied Shell screenshots.

## Manual fallback route

If the automated script is blocked by a host-specific prerequisite, continue from the first missing layer using [`INSTALLATION.md`](INSTALLATION.md) and [`NAPCAT_SETUP.md`](NAPCAT_SETUP.md). Do not redo working layers.

The core WSL plugin commands are:

```bash
cd ~
git clone https://github.com/riki-forsure/dsh-napcatqq-remote.git dsh-qq-channel
cd ~/dsh-qq-channel
corepack enable
CI=1 pnpm install --frozen-lockfile
node --test
pnpm prune --prod --config.auto-install-peers=false

if [ ! -f ~/.dsh/.agent-presets/router-standard/preset.yml ]; then
  dsh plugin --profile web add github:yjh051108/dsh-routing-suite
fi

dsh plugin --profile web add "$PWD"
```

The prune step is required for a source/ZIP checkout. It prevents test-resolved DSH packages from shadowing the active host API. Never copy a full development `node_modules` tree into the live plugin. Run `node scripts/check-dsh-version.mjs "$(dsh --version)"`; keep compatible `0.1.x` installations, use npm `latest` for a missing/too-old host, and treat a GitHub main/alpha snapshot as unverified until end-to-end acceptance passes.

If the user's established DSH invocation is `npx @deepseek-ai/dsh`, use that same invocation for both `plugin --profile web` and `web`; do not split one profile across unrelated DSH installations.

For a new local config copy `config.example.json` to `~/.dsh/qq-channel/config.json`. Merge an existing file instead of replacing it. Required fields:

```json
{
  "allowedContacts": ["CONTACT_QQ"],
  "websocketUrl": "ws://WINDOWS_WSL_HOST:3001",
  "accessToken": "ONEBOT_ACCESS_TOKEN",
  "stylePromptFile": "",
  "emojiRoot": "",
  "botSelfId": "",
  "agentPreset": "router-standard",
  "fallbackAgentPresets": ["router-standard", "standard", "minimal"],
  "agentProvider": "deepseek-official",
  "agentModel": "deepseek-v4-flash-vision-exp",
  "agentReasoningEffort": "max",
  "maxAttachmentBytes": 52428800,
  "maxImageBytes": 20971520,
  "filePreviewBytes": 8192
}
```

Environment variables `DSH_QQ_*` override JSON. Audit them before diagnosing a configuration that appears ignored.

## Model and DSH acceptance

If an ordinary DSH WebUI task does not work, open the existing DSH model settings and configure a provider/model with the user-supplied API credential. Preserve a working provider. The default QQ model name in this repository is `deepseek-v4-flash-vision-exp`; if unavailable, set `agentProvider`/`agentModel` to IDs proven in that DSH profile. Image understanding requires a vision-capable model.

Before any controlled DSH restart:

```bash
node --test
node scripts/check-dsh-version.mjs "$(dsh --version)"
pnpm prune --prod --config.auto-install-peers=false
dsh --profile web --dump-config >/tmp/dsh-qq-config-check.txt
grep -q 'qq-channel' /tmp/dsh-qq-config-check.txt
```

Confirm the pruned plugin tree has no private `node_modules/@deepseek-ai/dsh-*` API packages. The runtime must resolve those APIs from the same DeepSeek Harness instance that starts the WebUI.

Delete the temporary dump after checking and never quote its secret-bearing content. If DSH is already running and restart was not requested, finish installation, report that activation is pending, and leave the process untouched.

## End-to-end validation

After login and activation, ask the allow-listed contact to send:

```text
/状态
```

Then:

```text
在 QQ 渠道工作区新建 hello.txt，内容写“连接成功”，然后把文件发回给我。
```

Also validate:

```text
/历史
/切换 1
/新任务
```

Expected behavior:

- `/状态` and other commands are handled without creating unnecessary model work;
- the first ordinary message lazily creates a contact session in the QQ workspace;
- files/images can be received, processed, and returned;
- a second message during active work steers the same task;
- DSH questions appear as ordinary numbered QQ text, never a WebUI-only choice dialog;
- `/历史` lists at most ten sessions belonging only to that contact;
- `/切换` rejects active work and resumes the selected history on the next ordinary message;
- `/新任务` removes only the current mapping and does not delete history.

Do not fake an end-to-end result when a human QQ message has not been sent.

## Required final report

Report concise evidence with identifiers redacted:

```text
Repository commit/tag and plugin version:
NapCat kind and root (Shell/OneKey or Desktop):
DSH invocation/version/profile:
Node/pnpm versions:
Routing preset installation and actual preset:
Repository tests:
Config path and backup path:
QQ workspace/state path:
OneBot endpoint reachability:
Desktop shortcut paths:
DSH process count before/after:
/status and ordinary file-return result:
Human step or controlled restart still pending:
```

## Runtime behavior that documentation/tests must preserve

- Commands: `/状态`, `/status`, `/新任务`, `/new`, `/历史`, `/history`, `/切换 <序号或ID>`, `/switch <index-or-id>`.
- Commands and history are contact-scoped.
- Same-contact tasks serialize; different contacts can run concurrently.
- Active-task messages steer the current task.
- Files, images, built-in faces, and market faces are supported when actual bytes/metadata exist.
- Outbound tools: `qq_send_file`, `qq_send_image`, `qq_send_face`, `qq_send_mface`.
- Default limits: 50 MiB files, 20 MiB images.
- Existing local style is preserved. A blank `stylePromptFile` means the selected DSH Agent preset supplies the default tone.
