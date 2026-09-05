# 从零开始：DeepSeek Harness、NapCatQQ 与插件完整安装

这份教程面向第一次安装的 Windows 用户，从 WSL2、Node.js、DeepSeek Harness（dsh）、模型配置、NapCatQQ，一直做到 QQ 远程任务验证。

已经能运行 dsh 和 NapCat 时用 [`QUICKSTART.md`](QUICKSTART.md)；只有 NapCat 没装但具备基础时用 [`NAPCAT_SETUP.md`](NAPCAT_SETUP.md)；交给本地 Agent 时让它读取 [`AGENTS.md`](AGENTS.md)。

## 安装完成后会得到什么

```text
Windows 10/11
├─ QQ / NapCatQQ Desktop
│  ├─ 登录机器人 QQ
│  └─ OneBot 11 WebSocket Server：0.0.0.0:3001
│
└─ WSL2 Ubuntu
   ├─ Node.js 24、pnpm、Git
   ├─ DeepSeek Harness WebUI：127.0.0.1:3080
   ├─ dsh-napcatqq-remote 插件
   ├─ ~/.dsh/qq-channel/             本地配置与会话映射
   └─ ~/dsh-work/qq-channel-workspace/  QQ 专用工作区
```

消息链路是：

```text
白名单联系人 → 机器人 QQ → NapCatQQ → OneBot 11
→ 本插件 → DeepSeek Harness 的 QQ 工作区/会话/模型/工具
→ 本插件 → NapCatQQ → 原联系人
```

NapCatQQ 只负责 QQ 与 OneBot；本插件负责渠道、白名单、附件和会话；dsh 才负责真正执行工作。

## 第 1 步：准备 Windows 和 WSL2 Ubuntu

推荐环境：

| 组件 | 推荐位置 | 说明 |
| --- | --- | --- |
| QQ NT、NapCatQQ Desktop | Windows 10/11 x64 | 登录机器人 QQ、收发消息 |
| DeepSeek Harness、本插件 | WSL2 Ubuntu | 运行 Agent、工具和 QQ 独立工作区 |

### 1.1 检查 WSL

在 Windows PowerShell 中执行：

```powershell
wsl --status
```

如果能看到默认发行版和 WSL 版本，继续下一节。若尚未安装，以管理员身份打开 PowerShell：

```powershell
wsl --install -d Ubuntu
```

按提示重启 Windows，然后从开始菜单打开 Ubuntu，设置一个 Linux 用户名和密码。输入 Linux 密码时屏幕不会显示字符，这是正常现象。

再次在 PowerShell 检查：

```powershell
wsl --list --verbose
```

Ubuntu 的 VERSION 应为 `2`。若不是：

```powershell
wsl --set-version Ubuntu 2
```

后续没有特别标注的命令都在 **WSL Ubuntu 终端**中执行，不在 Windows CMD 中执行。

## 第 2 步：安装 Node.js、pnpm 和 Git

DeepSeek Harness 当前处于开发者预览阶段，上游开发环境支持 Node.js `^22.19.0` 或 `>=24.0.0`。为减少版本判断，本文使用 Node.js 24。

### 2.1 安装基础工具

在 WSL Ubuntu 中执行：

```bash
sudo apt update
sudo apt install -y git curl build-essential
```

### 2.2 用 nvm 安装 Node.js 24

安装当前 nvm，然后载入它：

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.6/install.sh | bash
source ~/.bashrc
```

若将来该版本链接失效，请到 [nvm 官方安装说明](https://github.com/nvm-sh/nvm#installing-and-updating)复制最新命令。继续安装 Node.js：

```bash
nvm install 24
nvm alias default 24
nvm use 24
```

如果重新打开终端后提示 `nvm: command not found`：

```bash
source ~/.bashrc
```

### 2.3 启用 pnpm

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

检查版本：

```bash
node -v
npm -v
pnpm -v
git --version
```

`node -v` 应为 `v22.19.0` 或更高的 22.x，或者 `v24.x`/更新的受支持偶数版本。Git 建议 2.26 或更高。

## 第 3 步：启动并设置 DeepSeek Harness

DeepSeek Harness 是本方案真正运行模型、工具、工作区与会话的 Agent 环境。NapCat 和本插件都不能代替它。

### 3.1 首次运行 WebUI

在 WSL Ubuntu 中创建一个普通工作目录：

```bash
mkdir -p ~/dsh-work/main
cd ~/dsh-work/main
npx @deepseek-ai/dsh web
```

官方 npx 方式默认在 `http://127.0.0.1:3080/` 启动 WebUI，并尝试打开浏览器。没有自动跳转时手动在 Windows 浏览器打开该地址。

终端必须保持运行。不要再开第二个 `dsh web`；两个实例会争用 3080，并可能表现为启动后不跳转或 WebUI 加载异常。

### 3.2 配置模型

1. 打开 dsh WebUI。
2. 进入 **Settings → Models**。
3. 添加实际使用的模型提供商和 API Key。
4. 保存。
5. 记下提供商 ID 和模型 ID；本插件配置中的 `agentProvider`、`agentModel` 必须与它们匹配。

仓库模板默认使用：

```text
provider: deepseek-official
model: deepseek-v4-flash-vision-exp
reasoning effort: max
```

这个模型适合图片和可解析的 QQ 表情。若账号没有该模型权限，可改成 dsh 中实际可用的模型；换成纯文本模型后，文件任务仍可运行，但不能按图片像素理解内容。

### 3.3 选择工作区并测试普通对话

1. 在 WebUI 点击 **Choose workspace**。
2. 添加并选择 `~/dsh-work/main`。
3. 新建一个普通对话。
4. 发送“列出当前工作区路径并回复 OK”。

只有模型能正常回答后才继续安装 QQ 渠道。若普通对话都失败，先处理模型/API Key 问题；NapCat 不会修复模型配置。

### 3.4 记住你的 dsh 调用方式

本教程用官方的：

```bash
npx @deepseek-ai/dsh
```

如果你从源码运行或已有 `dsh` 命令，后续可以把 `npx @deepseek-ai/dsh` 替换成自己一直使用的 `dsh`，但安装插件、查看配置和启动 WebUI 必须使用同一套 dsh 安装与同一个 profile 数据目录。

完成测试后，在运行 WebUI 的终端按 `Ctrl+C` 暂时停止它，稍后装完插件再启动。

## 第 4 步：安装并登录 NapCatQQ Desktop

### 4.1 下载和安装

1. 在 Windows 打开 [NapCatQQ Desktop 官方 Releases](https://github.com/NapNeko/NapCatQQ-Desktop/releases)。
2. 打开 Latest 版本。
3. 下载 `NapCatQQ-Desktop-<版本>-x64.msi` 或同类 `NapCatQQ-Desktop-x64.msi`。
4. 不要下载名称含 `watch-v` 的监控工具。
5. 双击 MSI，完成安装并启动。

### 4.2 登录机器人 QQ

1. 在 NapCatQQ Desktop 添加或启动 Bot。
2. 登录专门负责收发消息的机器人 QQ。
3. 人工完成扫码、密码、设备或风控验证。
4. 确认 Bot 显示在线。
5. 打开 NapCat WebUI，记下 WebUI 地址与登录 Token。

机器人账号是“接收任务并回消息”的账号；允许使用插件的发送者 QQ 稍后填入 `allowedContacts`。

### 4.3 创建 OneBot 11 WebSocket Server

在 NapCat WebUI 的“网络配置”中创建 **OneBot 11 WebSocket Server**：

| 字段 | 推荐值 |
| --- | --- |
| 启用 | 开启 |
| 类型 | WebSocket Server，不是 Reverse WebSocket |
| Host | `0.0.0.0` |
| Port | `3001` |
| 消息格式 | `array` |
| `reportSelfMessage` | 关闭 |
| Access Token | 建议填写随机长字符串 |

保存并启用。Windows 防火墙弹窗中只允许“专用网络”。

NapCat WebUI 登录 Token 与 OneBot Access Token 是两套凭据。本插件只填写 OneBot Access Token。

完整截图式逻辑、同机部署和 NapCat 专项排错见 [`NAPCAT_SETUP.md`](NAPCAT_SETUP.md)。

### 4.4 从 WSL 找到 Windows 地址

在 WSL Ubuntu 中：

```bash
ip route show default | awk '{print $3; exit}'
```

假设输出 `172.20.0.1`，测试：

```bash
timeout 3 bash -c '</dev/tcp/172.20.0.1/3001' \
  && echo 'NapCat 端口可访问' \
  || echo 'NapCat 端口不可访问'
```

成功后，稍后填写：

```text
ws://172.20.0.1:3001
```

镜像网络环境也可能直接使用 `ws://127.0.0.1:3001`。以实际测试为准。

## 第 5 步：下载并安装本插件

在 WSL Ubuntu 中：

```bash
cd ~
git clone https://github.com/riki-forsure/dsh-napcatqq-remote.git dsh-qq-channel
cd ~/dsh-qq-channel
pnpm install --frozen-lockfile
pnpm test
```

测试应全部通过。然后把当前源码目录加入 dsh 的 `web` profile：

```bash
npx @deepseek-ai/dsh plugin --profile web add "$PWD"
```

已经使用全局 `dsh` 命令的环境则执行：

```bash
dsh plugin --profile web add "$PWD"
```

不要同时使用两套 dsh 安装管理同一个 profile。安装命令会让 dsh 根据本仓库 `package.json` 和 `cordis.patch.yml` 自动装载插件。

## 第 6 步：建立本地配置

```bash
mkdir -p ~/.dsh/qq-channel
cp ~/dsh-qq-channel/config.example.json ~/.dsh/qq-channel/config.json
```

使用 Windows 记事本：

```bash
notepad.exe "$(wslpath -w ~/.dsh/qq-channel/config.json)"
```

或使用终端编辑器：

```bash
nano ~/.dsh/qq-channel/config.json
```

模板内容：

```json
{
  "allowedContacts": ["10001", "10002"],
  "websocketUrl": "ws://172.20.0.1:3001",
  "accessToken": "ONEBOT_ACCESS_TOKEN",
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

至少修改：

1. `allowedContacts`：填允许发送工作消息的联系人 QQ；只有一个时写成 `["联系人QQ"]`。
2. `websocketUrl`：换成上一节验证成功的地址。
3. `accessToken`：与 NapCat OneBot WebSocket Server 完全一致；两边都留空时这里也留空。

### 完整配置字段

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `allowedContacts` | `[]` | 允许触发 dsh 的消息发送者 QQ；必须填写。 |
| `websocketUrl` | `ws://127.0.0.1:3001` | NapCat OneBot 11 WebSocket Server 地址。 |
| `accessToken` | 空 | OneBot Access Token；必须与 NapCat 一致。 |
| `stylePromptFile` | 空 | 自定义语气文件的绝对路径；空值表示使用默认语气。 |
| `emojiRoot` | 空 | QQ NT 表情数据根目录；空值时自动探测。 |
| `botSelfId` | 空 | 机器人 QQ；通常自动识别，表情缓存定位异常时可手填。 |
| `agentPreset` | `router-auto` | 首选 Agent 预设，不是模型名。 |
| `fallbackAgentPresets` | `router-standard`、`standard`、`minimal` | 首选不可用时按顺序回退。 |
| `agentProvider` | `deepseek-official` | dsh 中已配置的模型提供商 ID。 |
| `agentModel` | `deepseek-v4-flash-vision-exp` | QQ 渠道使用的模型 ID；识图需要视觉模型。 |
| `agentReasoningEffort` | `max` | 模型推理强度。 |
| `maxAttachmentBytes` | `52428800` | 普通附件上限 50 MiB。 |
| `maxImageBytes` | `20971520` | 图片上限 20 MiB。 |
| `filePreviewBytes` | `8192` | 文本文件送给模型的预览上限 8 KiB。 |

JSON 使用英文双引号，不能写注释，末项不能有多余逗号。检查语法：

```bash
node -e "JSON.parse(require('fs').readFileSync(process.env.HOME+'/.dsh/qq-channel/config.json','utf8')); console.log('config.json 语法正确')"
```

## 第 7 步：可选——设置 QQ 回复语气

默认 `stylePromptFile` 为空，插件不会模仿任何联系人。默认回复风格来自实际 Agent 预设，通常直接、清楚、以完成工作为主。

复制仓库模板：

```bash
cp ~/dsh-qq-channel/contact-style.example.md ~/.dsh/qq-channel/contact-style.md
```

编辑：

```bash
notepad.exe "$(wslpath -w ~/.dsh/qq-channel/contact-style.md)"
```

模板可以写：

- 日常回复长短；
- 对联系人的称呼；
- 常用语气词和标点；
- 复杂任务的汇报格式；
- 不希望出现的表达；
- 几组“对方怎么说—希望如何回复”的示例。

取得绝对路径：

```bash
realpath ~/.dsh/qq-channel/contact-style.md
```

把完整输出填入 `stylePromptFile`，例如：

```json
"stylePromptFile": "/home/YOUR_USER/.dsh/qq-channel/contact-style.md"
```

不要写 `~`，必须使用绝对路径。这个模板对所有白名单联系人共同生效，只影响 QQ 渠道。修改后要重启 dsh。

## 第 8 步：检查配置、启动并验收

先查看 dsh 最终组合配置：

```bash
npx @deepseek-ai/dsh --profile web --dump-config | grep -A 20 'qq-channel'
```

确认能看到 `qq-channel`、NapCat 地址、工作区和预设候选链。不要把带 Token 的完整输出公开。

启动唯一的 WebUI：

```bash
cd ~/dsh-work/main
npx @deepseek-ai/dsh web --host 127.0.0.1 --port 3080
```

使用全局命令的环境改为 `dsh web ...`。打开 `http://127.0.0.1:3080/`。

从白名单联系人 QQ 私聊机器人：

```text
/状态
```

应看到 OneBot 连接、QQ 工作区、白名单数量、语气、实际 Agent 预设、视觉模型和推理强度。然后发送：

```text
在 QQ 渠道工作区新建 hello.txt，写入“连接成功”，再把文件发回给我。
```

第一条普通消息会懒创建该联系人的 dsh 会话。文件成功发回说明 QQ、NapCat、插件、dsh、模型和工具链均已打通。

继续测试工作中途调整：在任务尚未结束时发送：

```text
再加一行当前日期。
```

新要求会 steer 到当前任务。发送 `/新任务` 后，下一条普通消息才会新建会话；旧会话仍保留在 dsh WebUI。

## 图片、文件和表情的实际支持范围

### 接收

- OneBot 图片段会下载/保存为 dsh 原生图片附件。
- 普通文件保存到 QQ 工作区的 `.qq-inbox/<联系人QQ>/`。
- 文件形式的 PNG、JPEG、WebP、GIF 等常见图片可作为图片内容处理。
- QQ 内置 `face` 保留编号，并尝试从 QQ NT 缓存读取 PNG/APNG 等真实资源。
- 商城 `mface` / `marketface` 保留 ID、包 ID、key 和摘要，并尝试解析真实图片。

### 返回 QQ

Agent 可调用：

| 工具 | 用途 |
| --- | --- |
| `qq_send_file` | 把工作区文件作为 QQ 文件发回 |
| `qq_send_image` | 把 PNG、JPEG、WebP、GIF 作为 QQ 图片发回 |
| `qq_send_face` | 使用已知数字 `face_id` 发送 QQ 内置表情 |
| `qq_send_mface` | 使用消息中已有的完整商城表情字段发送商城表情 |

插件不会猜不存在的商城表情 ID。若没有真实图片，模型只收到编号/摘要，不会把占位图当成原表情。

### 指定 QQ NT 表情目录

自动探测失败时，在 `config.json` 设置 `emojiRoot`。WSL 路径示例：

```text
/mnt/c/Users/WINDOWS_USER/Documents/Tencent Files/BOT_QQ/nt_qq/nt_data
```

实际目录随 QQ NT 设置和版本变化，请以机器人账号当前数据目录为准。WSL 用户名与 Windows 用户名不同且需要自动探测时，可在启动 dsh 前设置：

```bash
export DSH_QQ_WINDOWS_USER="WINDOWS_USER"
```

## Agent 预设与 dsh-routing-suite

默认选择顺序：

```text
router-auto → router-standard → standard → minimal
```

- `router-auto` 是为既有部署保留的首选 Agent 预设名称，不是模型。
- `router-standard` 可来自独立项目 [dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)。
- `standard` 和 `minimal` 是 dsh 内置预设。

因此 dsh-routing-suite 是可选且推荐的增强，不是安装前置。未安装时插件自动回退到内置预设；`/状态` 会显示实际使用项和降级原因。只有用户明确希望安装路由套件时，才按它自己的仓库说明安装。

## 本地目录与配置优先级

默认目录：

```text
~/.dsh/qq-channel/
├── config.json
├── contact-style.md
└── state.json

~/dsh-work/qq-channel-workspace/
├── .qq-inbox/<联系人QQ>/
└── corpus/live/<联系人QQ>/dialogue.jsonl
```

图片主体由 dsh attachment 服务管理。不要把这里的配置、Token、QQ 号、文件和聊天语料复制进 Git 仓库。

环境变量高于 `config.json`：

```bash
export DSH_QQ_CONTACTS="10001,10002"
export DSH_QQ_WS_URL="ws://172.20.0.1:3001"
export DSH_QQ_TOKEN="ONEBOT_ACCESS_TOKEN"
export DSH_QQ_WORKSPACE="$HOME/dsh-work/qq-channel-workspace"
export DSH_QQ_STYLE_PROMPT="$HOME/.dsh/qq-channel/contact-style.md"
export DSH_QQ_AGENT_PRESET="router-auto"
export DSH_QQ_FALLBACK_PRESETS="router-standard,standard,minimal"
export DSH_QQ_AGENT_PROVIDER="deepseek-official"
export DSH_QQ_AGENT_MODEL="deepseek-v4-flash-vision-exp"
export DSH_QQ_REASONING_EFFORT="max"
export DSH_QQ_EMOJI_ROOT=""
export DSH_QQ_SELF_ID=""
```

JSON 修改无效时先检查：

```bash
printenv | grep '^DSH_QQ_' || true
```

`DSH_QQ_CONTACTS` 会完全覆盖 `allowedContacts`。不再使用时：

```bash
unset DSH_QQ_CONTACTS
```

## 可选：用历史聊天生成语气素材

这不是插件运行的前置。`scripts/build_qq_corpus.py` 可处理已有 JSONL、明文 SQLite，或由用户在当前终端提供运行时密钥的 NT QQ SQLCipher 数据库副本。

从 JSONL 构建：

```bash
python3 scripts/build_qq_corpus.py \
  --input-jsonl /path/to/messages.jsonl \
  --output-dir "$HOME/dsh-work/qq-channel-workspace/corpus/PEER_QQ" \
  --owner-qq OWNER_QQ \
  --peer-qq PEER_QQ \
  --owner-name owner \
  --peer-name contact \
  --style-limit 160
```

读取 SQLCipher 数据库需要系统 `sqlcipher`，密钥只通过当前进程环境提供：

```bash
export QQ_DB_KEY='RUNTIME_KEY'
python3 scripts/build_qq_corpus.py \
  --db /path/to/nt_msg.db \
  --output-dir "$HOME/dsh-work/qq-channel-workspace/corpus/PEER_QQ" \
  --owner-qq OWNER_QQ \
  --peer-qq PEER_QQ
unset QQ_DB_KEY
```

只处理明确选择的数据库副本。不要提交聊天数据库、密钥、生成语料或真实联系人模板。

## 分层故障排查

一次只排查一层：QQ 账号 → NapCat → 插件 → DeepSeek Harness/模型。

### 第一层：QQ 账号与消息方向

1. NapCat 登录的是机器人 QQ，并且显示在线。
2. 消息由 `allowedContacts` 中的联系人发给机器人。
3. 白名单填写发送者，不是机器人。
4. 当前版本只处理私聊，不处理群聊。
5. 机器人自己发送的消息会忽略。

### 第二层：NapCat 与网络

1. WebSocket Server 已启用，不是 Reverse WebSocket。
2. dsh 在 WSL 时 Host 使用 `0.0.0.0`，端口 3001。
3. 消息格式为 `array`，`reportSelfMessage` 关闭。
4. 从 WSL 测试 Windows 主机的 3001 端口。
5. 两边 OneBot Access Token 一致，且没有误用 WebUI Token。
6. 查看 NapCat 日志是否收到私聊、是否出现 WebSocket 客户端连接。

更详细的 NapCat 排错见 [`NAPCAT_SETUP.md`](NAPCAT_SETUP.md#napcat-层常见问题)。

### 第三层：插件配置与会话

1. 使用 Node 读取 `config.json`，确认 JSON 语法正确。
2. 检查 `DSH_QQ_CONTACTS` 等环境变量是否覆盖 JSON。
3. 使用 `--dump-config` 确认 `qq-channel` 已进入 web profile。
4. 修改配置后完整重启原 dsh 进程。
5. `/状态` 只验证插件本地指令，不会创建联系人会话。
6. 联系人发送第一条普通任务后才写入 `state.json`。
7. `/新任务` 只解除映射，下一条普通消息才建立新会话。

### 第四层：DeepSeek Harness、模型和 Agent

如果 `/状态` 能回复但普通任务失败：

1. 在普通 dsh WebUI 对话中测试模型。
2. 确认 `agentProvider` 和 `agentModel` 与 Settings → Models 中的实际 ID 一致。
3. 打开“QQ 渠道”工作区查看任务是运行、等待工具还是报错。
4. 查看 dsh 启动终端的模型、工具或预设错误。
5. `/状态` 显示降级到 `standard`/`minimal` 时仍可运行；只有“没有可用 Agent 预设”才是预设阻断。
6. 检查是否有多个 `dsh web`：

```bash
ss -ltnp | grep ':3080'
```

只保留一个实例。NapCat 连接失败时插件会自动重连，不需要反复启动 dsh。

## 更新插件

```bash
cd ~/dsh-qq-channel
git pull --ff-only
pnpm install --frozen-lockfile
pnpm test
npx @deepseek-ai/dsh plugin --profile web add "$PWD"
```

更新后重启原 dsh WebUI。配置、状态、工作区和会话不会被这些命令自动删除。

## 卸载插件

```bash
npx @deepseek-ai/dsh plugin --profile web remove dsh-qq-channel
```

重启 dsh。该命令不会删除 `~/.dsh/qq-channel/`、QQ 工作区或历史会话，是否备份/清理由用户自行决定。

## 官方资料与下一步

- [DeepSeek Harness GitHub](https://github.com/deepseek-ai/deepseek-harness)
- [DeepSeek Harness WebUI 使用指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/index.md)
- [DeepSeek Harness CLI 与插件管理](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md)
- [NapCatQQ 官方文档](https://napneko.github.io/)
- [NapCatQQ Desktop Releases](https://github.com/NapNeko/NapCatQQ-Desktop/releases)

环境齐全后，日常安装/更新只需看 [`QUICKSTART.md`](QUICKSTART.md)。返回功能、QQ 指令和组件关系请看 [`README.md`](README.md)。
