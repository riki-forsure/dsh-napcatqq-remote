# DSH NapCatQQ Remote

基于 NapCatQQ / OneBot 11 的 DSH QQ 远程任务操控插件。

让指定 QQ 联系人通过私聊给 dsh 安排工作。

插件从 NapCatQQ 的 OneBot 11 WebSocket 接收消息，把消息送入单独的 dsh 工作区，再将文字、图片、文件和 QQ 表情回复给原联系人。

> 本项目不是 QQ 客户端。必须同时运行已登录机器人 QQ 的 NapCatQQ 和 dsh。

## 能做什么

- 只响应白名单中的 QQ 联系人，忽略其他私聊、群聊和机器人自己发出的消息。
- 每个联系人拥有独立的 dsh 会话、上下文、文件目录和任务队列，互不串线。
- 同一联系人连续发消息时继续当前会话；上下文不会自动切换。
- 发送 `/新任务` 或 `/new` 后，下一条普通消息才会建立新会话。
- dsh 正在工作时，新消息会补充到当前任务中，不会重复创建并发任务。
- 支持接收和发送文字、图片、普通文件、QQ 内置表情及商城表情。
- 可选自定义 QQ 回复语气；语气文件只影响 QQ 渠道，不影响其他 dsh 工作区。
- 联系人与 dsh 会话的对应关系会保存，重启 dsh 后仍可继续。

## 工作原理

```text
白名单联系人
    ↓ 私聊消息
机器人 QQ（NapCatQQ 已登录）
    ↓ OneBot 11 WebSocket
dsh-qq-channel
    ├─ QQ 渠道独立工作区
    ├─ 联系人 A 的独立会话
    ├─ 联系人 B 的独立会话
    └─ dsh 模型与工具
    ↓
NapCatQQ 将结果发回原联系人
```

这里有两类 QQ 号：

| 名称 | 是谁 | 填在哪里 |
| --- | --- | --- |
| 机器人 QQ | 在 NapCatQQ 中登录、负责收发消息的账号 | 一般不用填写；需要时填入 `botSelfId` |
| 白名单联系人 | 给机器人 QQ 发消息、希望使用 dsh 的发送者 | 填入 `allowedContacts` |

`allowedContacts` 填发送者，不是机器人自己的 QQ 号。

## 阅读导航

- **第一部分：真人手动安装**——给第一次接触 dsh、NapCat 和 GitHub 的用户，按页面和命令逐步操作。
- **第二部分：交给本地 Agent 安装**——提供可直接复制给 Codex、Claude Code 等本地 Agent 的安装任务书。
- **第三部分：发布与参与开发**——给仓库维护者，包含测试、首次发布、隐私检查和上游署名。

## 第一部分：真人手动安装

### 安装前需要准备

推荐环境是“Windows 运行 NapCatQQ，WSL Ubuntu 运行 dsh”。如果 NapCatQQ 和 dsh 都在 Linux，也可以使用。

#### 必需依赖

| 依赖 | 用途 | 检查方法 |
| --- | --- | --- |
| Windows 10/11 x64 | 运行 QQ、NapCatQQ Desktop；纯 Linux 部署可不需要 | `winver` |
| WSL Ubuntu | 推荐的 dsh 运行环境 | Windows PowerShell 执行 `wsl --status` |
| Node.js 20 或更高 | 运行 dsh 和插件 | WSL 执行 `node -v` |
| pnpm | 安装插件依赖 | WSL 执行 `pnpm -v` |
| Git | 从 GitHub 下载项目 | WSL 执行 `git --version` |
| dsh WebUI | 实际执行工作 | WSL 执行 `dsh --version` |
| NapCatQQ 4.x | 把 QQ 消息转换成 OneBot 事件 | 打开 NapCat WebUI 查看 |
| 一个可用的 dsh 模型 | 生成回复、执行任务 | dsh WebUI 中能正常对话 |

可选但推荐安装 [dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)。它提供 `router-standard` 等路由预设；本插件不会复制或捆绑该项目。没有安装也可以运行，插件会自动选择 dsh 自带的 `standard` 或 `minimal`。

官方入口：

- [DeepSeek Harness（dsh）官网](https://www.deepseek.com/harness/)
- [DeepSeek Harness GitHub](https://github.com/deepseek-ai/deepseek-harness)
- [NapCatQQ 官方文档](https://napneko.github.io/)
- [NapCatQQ Desktop 下载页](https://github.com/NapNeko/NapCatQQ-Desktop/releases)

#### 依赖自检

打开 WSL Ubuntu，逐条执行：

```bash
node -v
pnpm -v
git --version
dsh --version
```

只要四条命令都能显示版本号，就可以继续。若只有 `pnpm` 不存在：

```bash
npm install -g pnpm
```

如果 `dsh` 命令不存在，请先按 dsh 官方快速入门安装。也可以在本文所有 `dsh` 命令前改用 `npx @deepseek-ai/dsh`，例如：

```bash
npx @deepseek-ai/dsh web
```

开始安装插件前，还要确认：

1. dsh WebUI 已经能正常打开并完成普通对话。
2. NapCatQQ 已安装并登录“机器人 QQ”。
3. 你知道哪些联系人 QQ 号可以使用此渠道。

### 十分钟安装：Windows NapCatQQ + WSL dsh

下面是最推荐、也最容易排查问题的安装方式。所有命令都在 WSL Ubuntu 中执行，NapCat 的页面操作在 Windows 中完成。

#### 第 1 步：在 NapCat 中开启 WebSocket

1. 启动 NapCatQQ，并登录用作机器人的 QQ 账号。
2. 打开 NapCat WebUI。地址和 WebUI 登录 Token 通常会显示在 NapCat 启动窗口。
3. 在左侧进入“网络配置”。
4. 点击“新建”或“添加配置”。
5. 类型选择“OneBot 11 WebSocket 服务端”或“WebSocket Server”。
6. 按下面填写并保存：

| NapCat 项目 | 建议值 |
| --- | --- |
| 启用 | 开启 |
| 主机/Host | `0.0.0.0` |
| 端口/Port | `3001` |
| 消息格式 | `array` |
| `reportSelfMessage` | 关闭 |
| Access Token | 初次安装可留空；填写后插件必须使用同一个值 |

7. 保存后确认该配置处于启用状态。
8. Windows 首次弹出防火墙提示时，允许 NapCat 在“专用网络”通信。

注意：NapCat WebUI 的登录 Token 与 OneBot 配置里的 Access Token 不是同一个概念。本插件只使用 OneBot 的 Access Token。

#### 第 2 步：取得 Windows 主机地址

在 WSL Ubuntu 中执行：

```bash
ip route show default | awk '{print $3; exit}'
```

例如输出：

```text
172.20.0.1
```

那么稍后填写的 WebSocket 地址就是：

```text
ws://172.20.0.1:3001
```

如果 WSL 使用镜像网络并且能直接访问 Windows localhost，也可以使用 `ws://127.0.0.1:3001`。不确定时，优先使用上面命令得到的地址。

#### 第 3 步：从 GitHub 下载并安装插件

本项目的 GitHub 仓库地址是：

```bash
cd ~
git clone https://github.com/riki-forsure/dsh-napcatqq-remote.git dsh-qq-channel
cd ~/dsh-qq-channel
pnpm install
dsh plugin --profile web add "$PWD"
```

如果最后一条命令没有报错，插件已经加入 dsh 的 `web` profile。插件的 `package.json` 会让 dsh 自动载入 `cordis.patch.yml`。

已经熟悉 dsh、且不需要保留源码目录的用户，也可以直接安装：

```bash
dsh plugin --profile web add github:riki-forsure/dsh-napcatqq-remote
```

#### 第 4 步：建立本地配置

使用源码安装时执行：

```bash
mkdir -p ~/.dsh/qq-channel
cp ~/dsh-qq-channel/config.example.json ~/.dsh/qq-channel/config.json
```

用 Windows 记事本打开配置：

```bash
notepad.exe "$(wslpath -w ~/.dsh/qq-channel/config.json)"
```

也可以在终端编辑：

```bash
nano ~/.dsh/qq-channel/config.json
```

使用 `nano` 时，保存按 `Ctrl+O`、回车，退出按 `Ctrl+X`。

最少只需要改三个地方：

```json
{
  "allowedContacts": ["10001", "10002"],
  "websocketUrl": "ws://172.20.0.1:3001",
  "accessToken": "",
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

需要修改的内容：

1. 把 `10001`、`10002` 换成允许使用 dsh 的联系人 QQ 号。只有一个联系人时写成 `["联系人QQ"]`。
2. 把 `172.20.0.1` 换成第 2 步得到的 Windows 主机地址。
3. 如果 NapCat OneBot 配置填写了 Access Token，将同一个值填到 `accessToken`；NapCat 留空时这里也留空。

JSON 注意事项：

- QQ 号必须放在英文双引号中。
- 多个 QQ 号之间使用英文逗号。
- 最后一项后面不要多写逗号。
- JSON 不能写注释。

完整字段说明：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `allowedContacts` | `[]` | 允许触发 dsh 的消息发送者 QQ 号；必须填写。 |
| `websocketUrl` | `ws://127.0.0.1:3001` | NapCat OneBot 11 WebSocket 服务端地址。 |
| `accessToken` | 空 | 必须与 NapCat OneBot 配置一致。 |
| `stylePromptFile` | 空 | 自定义语气文件的绝对路径；空值表示不启用自定义语气。 |
| `emojiRoot` | 空 | QQ NT 表情数据位置；留空时自动探测。 |
| `botSelfId` | 空 | 机器人 QQ 号；通常由 OneBot 事件自动识别，表情探测异常时可手动填写。 |
| `agentPreset` | `router-auto` | 首选 Agent 预设；未安装时自动尝试备用列表。 |
| `fallbackAgentPresets` | `router-standard`、`standard`、`minimal` | 按顺序尝试的备用预设；前两项不可用时仍可使用 dsh 内置预设。 |
| `agentProvider` | `deepseek-official` | dsh 中已经配置好的模型提供商 ID。 |
| `agentModel` | `deepseek-v4-flash-vision-exp` | QQ 渠道固定使用的模型；识图需要视觉模型。 |
| `agentReasoningEffort` | `max` | 模型推理强度。 |
| `maxAttachmentBytes` | `52428800` | 普通文件最大 50 MiB。 |
| `maxImageBytes` | `20971520` | 图片最大 20 MiB。 |
| `filePreviewBytes` | `8192` | 文本文件最多读取 8 KiB 作为模型预览。 |

`router-auto` 是 Agent 预设，不是模型名称。模型由 `agentProvider`、`agentModel` 和 `agentReasoningEffort` 决定。

##### 可选：安装更强的路由预设

默认选择顺序是：

```text
router-auto → router-standard → standard → minimal
```

- `router-auto` 是为现有部署保留的首选名称；干净安装里通常不存在。
- `router-standard` 来自推荐的开源项目 [yjh051108/dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)。请按该仓库当前 README 安装；本仓库不内嵌其源码。
- `standard` 和 `minimal` 是 dsh 自带预设，因此没有安装 routing suite 时，QQ 渠道仍可处理消息。

安装 routing suite 不是本插件的前置条件。启动时插件会检查预设是否存在且可用；`/状态` 会显示实际选中的预设，并在发生降级时说明原因。若旧对话记录使用的预设已经消失，插件会保留旧对话文件并为该联系人新建可用预设的对话，不会拿另一预设强行恢复旧上下文。

#### 第 5 步：可选——设置 QQ 回复语气

##### 默认语气是什么

新安装后，`stylePromptFile` 是空字符串，因此默认不模仿任何联系人，也不额外加载本仓库的语气模板。回复语气来自实际选中的 dsh Agent 预设，通常是直接、清楚、以完成工作为主。

如果本机另外安装了 `~/.dsh/skills/catgirl-rp/`，当前插件会把其中存在的身份文件作为额外本地身份层。干净环境通常没有这个目录，它也不随本仓库分发。

##### 启用仓库提供的语气模板

先复制模板：

```bash
cp ~/dsh-qq-channel/contact-style.example.md ~/.dsh/qq-channel/contact-style.md
```

打开模板：

```bash
notepad.exe "$(wslpath -w ~/.dsh/qq-channel/contact-style.md)"
```

模板位置：

```text
~/.dsh/qq-channel/contact-style.md
```

仓库原始示例位于：

```text
contact-style.example.md
```

建议修改复制后的文件，不要直接修改仓库示例。模板中可以写：

- 回答长短，例如“日常回复 1～3 句”。
- 称呼方式，例如“称呼对方为老板”。
- 常用语气词和标点习惯。
- 复杂任务的汇报格式。
- 不希望出现的表达。
- 几组“用户怎么说—希望如何回复”的示例。

取得模板的绝对路径：

```bash
realpath ~/.dsh/qq-channel/contact-style.md
```

将输出结果完整填入 `config.json` 的 `stylePromptFile`，例如：

```json
"stylePromptFile": "/home/YOUR_USER/.dsh/qq-channel/contact-style.md"
```

这个语气文件对所有白名单联系人共同生效，不会改变其他 dsh 工作区。修改模板后需要重启 dsh 才会重新读取。

#### 第 6 步：检查配置并启动 dsh

先检查 dsh 已经看到插件配置：

```bash
dsh --profile web --dump-config | grep -A 8 'qq-channel'
```

如果 dsh 已经在终端中运行，回到那个终端按 `Ctrl+C` 停止。然后重新启动：

```bash
dsh web --host 127.0.0.1 --port 3080
```

保持这个终端窗口打开。浏览器访问：

```text
http://127.0.0.1:3080/
```

插件只在 dsh 启动时读取配置，所以修改 `config.json` 或语气模板后都要完整重启 dsh。

#### 第 7 步：用 QQ 验证

必须使用 `allowedContacts` 中的联系人账号，给 NapCat 登录的机器人 QQ 发私聊：

```text
/状态
```

正常时会收到连接状态、白名单数量、工作区、模型、语气状态和实际 Agent 预设；发生预设降级时也会明确显示。

再发送一条普通任务，例如：

```text
请在 QQ 渠道工作区新建 hello.txt，内容写“连接成功”。
```

第一次普通消息会自动创建该联系人的 dsh 会话。此时 dsh WebUI 的“QQ 渠道”工作区中才会出现对应对话。

### 日常使用方法

#### 内置 QQ 指令

| 指令 | 作用 |
| --- | --- |
| `/状态`、`/status` | 查看渠道连接、工作区、模型和语气配置摘要。 |
| `/新任务`、`/new` | 结束该联系人的当前会话映射；下一条普通消息建立新会话。 |

除以上指令外，其他私聊消息都会作为 dsh 工作请求。

#### 会话与上下文

- 白名单只决定谁能发起工作，不会提前创建会话。
- 每个联系人第一次发送普通消息时，插件才创建独立 dsh 会话。
- 同一联系人之后的消息复用该会话，直到主动发送 `/新任务`。
- 旧会话文件不会因为 `/新任务` 被删除，仍可在 dsh WebUI 查看。
- 不同联系人可以同时工作；同一联系人内部按顺序处理，避免上下文互相覆盖。

#### 图片、文件和表情

- 联系人可以直接发送图片和普通文件，插件会保存并交给 dsh。
- 视觉模型可以直接读取图片；非视觉模型只能收到有限的附件信息。
- 模型可以通过 `qq_send_image`、`qq_send_file`、`qq_send_face`、`qq_send_mface` 回传内容。
- OneBot `face` 会保留 QQ 表情编号，并尝试读取 QQ NT 本地缓存。
- `mface`/`marketface` 会保留商城表情的 ID、包 ID、key 和摘要。
- 找不到实际表情图片时，模型只会收到编号或元数据，不会假装已经看见图片。

自动探测失败时，可以把 `emojiRoot` 指向 QQ NT 数据目录，例如：

```text
/mnt/e/QQrecord/Tencent Files/BOT_QQ/nt_qq/nt_data
```

WSL 用户名与 Windows 用户名不同时，可在启动 dsh 前设置：

```bash
export DSH_QQ_WINDOWS_USER="你的Windows用户名"
```

### 工作区和本地数据在哪里

默认 QQ 工作区：

```text
~/dsh-work/qq-channel-workspace/
├── .qq-inbox/<联系人QQ>/
│   └── ...                         收到的普通文件
└── corpus/live/<联系人QQ>/
    └── dialogue.jsonl              QQ 渠道产生的实时对话语料
```

插件本地状态：

```text
~/.dsh/qq-channel/
├── config.json                     连接、白名单、模型和语气配置
├── contact-style.md                可选的自定义语气文件
└── state.json                      联系人与 dsh 会话的映射
```

图片由 dsh attachment 服务保存。不要把这些运行数据提交到 GitHub。

### 可选：使用环境变量配置

普通用户建议直接编辑 `config.json`。环境变量适合服务化部署，而且优先级高于 JSON：

```bash
export DSH_QQ_CONTACTS="10001,10002"
export DSH_QQ_WS_URL="ws://172.20.0.1:3001"
export DSH_QQ_TOKEN="TOKEN"
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

特别注意：只要设置过 `DSH_QQ_CONTACTS`，它就会完全覆盖 `config.json` 中的 `allowedContacts`。JSON 改了但白名单没有变化时，先执行：

```bash
unset DSH_QQ_CONTACTS
```

### 常见问题

#### QQ 发消息后完全没有回复

按顺序检查：

1. 发送消息的账号是否真的写在 `allowedContacts`，不要误填机器人 QQ。
2. NapCat 登录的机器人 QQ 是否在线。
3. NapCat 的 WebSocket 服务端是否已启用，端口是否为 `3001`。
4. `websocketUrl` 的 IP 是否能从 WSL 访问。
5. NapCat 和插件的 Access Token 是否完全相同。
6. 修改配置后是否完整重启了 dsh。
7. 查看 dsh 启动终端和 NapCat 日志中的连接错误。

可在 WSL 测试端口：

```bash
timeout 3 bash -c '</dev/tcp/172.20.0.1/3001' && echo '端口可访问' || echo '端口不可访问'
```

把命令中的 IP 换成自己的 Windows 主机地址。

#### `/状态` 有回复，但普通消息没有结果

`/状态` 是插件本地指令，不需要调用模型。普通任务还依赖 dsh 模型和 agent：

1. 先在 dsh WebUI 新建普通对话，确认模型可以回复。
2. 检查 `agentProvider` 和 `agentModel` 是否是本机已配置的 ID。
3. 在 dsh WebUI 打开“QQ 渠道”，查看任务是否仍在运行或等待工具结果。
4. 必要时发送 `/新任务`，再发一条普通消息创建新会话。

如果 `/状态` 显示“已降级”，这只是说明首选预设未安装，渠道会继续使用显示出的备用预设。只有提示“没有可用的 Agent 预设”时才需要检查 dsh 安装。

#### 两个白名单联系人都不响应

1. 确认数组格式是 `["10001", "10002"]`。
2. 检查是否存在旧的 `DSH_QQ_CONTACTS` 环境变量。
3. 确认 JSON 没有中文引号、注释或尾随逗号。
4. 完整重启 dsh。

#### `state.json` 里只有一个联系人

这是正常的懒创建行为。另一个联系人发送第一条普通任务后才会写入映射；只发送 `/状态` 不会创建会话。

#### 改了语气但回复没变化

1. `stylePromptFile` 必须是绝对路径，不能写 `~`。
2. 确认文件真实存在：`test -f /绝对路径/contact-style.md && echo OK`。
3. 修改语气文件后完整重启 dsh。
4. 发送 `/状态` 检查语气状态。
5. 原会话上下文可能仍有旧表达习惯；可发送 `/新任务` 后重新测试。

#### WebUI 启动或加载缓慢

- 不要同时手动启动多个 `dsh web` 实例抢占同一个端口。
- 检查 3080 端口：`ss -ltnp | grep 3080`。
- 关闭多余实例后只保留一个 dsh WebUI。
- 插件连接 NapCat 失败时会自动重连，不需要反复启动 dsh。

### 更新插件

使用 Git 克隆安装时：

```bash
cd ~/dsh-qq-channel
git pull
pnpm install
dsh plugin --profile web add "$PWD"
```

使用 GitHub 包地址安装时：

```bash
dsh plugin --profile web update dsh-qq-channel
```

更新后完整重启 dsh。`~/.dsh/qq-channel/` 和 QQ 工作区不会自动删除。

### 卸载插件

```bash
dsh plugin --profile web remove dsh-qq-channel
```

然后重启 dsh。卸载命令不会自动删除配置、工作区和会话映射；如果确实不再需要，可自行备份后处理 `~/.dsh/qq-channel/` 与 `~/dsh-work/qq-channel-workspace/`。

### 可选：构建历史聊天语料

这不是插件运行所必需的功能。`scripts/build_qq_corpus.py` 可以处理已有 JSONL、明文 SQLite，或带运行时密钥的 NT QQ SQLCipher 数据库。

从已有 JSONL 构建：

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

读取 NT QQ 加密数据库还需要系统命令 `sqlcipher`，并通过当前终端的 `QQ_DB_KEY` 提供运行时密钥：

```bash
export QQ_DB_KEY='RUNTIME_KEY'
python3 scripts/build_qq_corpus.py \
  --db /path/to/nt_msg.db \
  --output-dir "$HOME/dsh-work/qq-channel-workspace/corpus/PEER_QQ" \
  --owner-qq OWNER_QQ \
  --peer-qq PEER_QQ
unset QQ_DB_KEY
```

密钥不会写入输出语料和 `manifest.json`。聊天记录涉及高度私密数据，只处理你明确选择的副本，不要把数据库、密钥或生成语料提交到本仓库。

## 第二部分：交给本地 Agent 安装

这一部分适合已经能操作本机终端和文件的 Agent。它不是另一套插件；只是把第一部分的步骤整理成带约束的任务书，以减少 Agent 猜路径、覆盖配置或抢占现有 dsh 进程的概率。

### 可直接复制的安装任务书

把下面整段复制给能访问本机终端的 Agent，再把联系人 QQ 和 NapCat 地址替换为实际值：

```text
请安装并配置 https://github.com/riki-forsure/dsh-napcatqq-remote 的 dsh-qq-channel。

目标环境：Windows 运行 NapCatQQ，WSL 运行 dsh WebUI。
白名单消息发送者 QQ：CONTACT_QQ_1,CONTACT_QQ_2
NapCat OneBot WebSocket：ws://WINDOWS_HOST:3001
OneBot Access Token：TOKEN_OR_EMPTY

执行约束：
1. 先只读检查 node、pnpm、git、dsh 版本，dsh web 进程、3080 端口、现有 web profile 插件、~/.dsh/qq-channel/ 和目标工作区。
2. 若已经安装同名插件，先报告实际来源和配置；保留现有 config.json、state.json、会话和语气文件，不得删除或清空。
3. 安装前为要修改的配置文件创建带时间戳的备份。不要把 Token、QQ 号、聊天语料或本地绝对路径写进仓库文件。
4. 克隆到独立源码目录，执行 pnpm install --frozen-lockfile 和 pnpm test，再使用 dsh plugin --profile web add 安装。
5. 根据 config.example.json 写 ~/.dsh/qq-channel/config.json；allowedContacts 填消息发送者，不填 NapCat 登录的机器人账号。
6. 保持 agentPreset=router-auto，fallbackAgentPresets=[router-standard,standard,minimal]。不要自行安装 dsh-routing-suite；即使没有该项目，内置 standard/minimal 也应可用。只有我明确要求时才按其官方仓库安装。
7. 若需要语气模板，把 contact-style.example.md 复制到 ~/.dsh/qq-channel/contact-style.md 后再修改，并把绝对路径写入 stylePromptFile；不修改仓库里的示例文件。
8. 先用隔离的 DSH_HOME 或 dsh --profile web --dump-config 验证配置。不要主动停止、重启或再启动一个 dsh web；需要重启时先告诉我原因和将影响的进程，等我确认。
9. 完成后报告：安装来源、插件版本、配置和备份路径、实际预设候选链、验证结果，以及仍需我在 NapCat 页面完成的操作。输出中隐藏 Token。
```

### Agent 安装验收清单

Agent 应当逐项给出证据，而不是只回复“已完成”：

- `pnpm test` 全部通过。
- `dsh --profile web --dump-config` 能看到 `qq-channel`、预设候选链和正确工作区。
- `config.json` 只存在于本地运行目录，权限和备份位置已说明。
- 没有新增第二个 `dsh web` 进程，也没有在未确认时重启原进程。
- 真人从白名单账号发送 `/状态` 后，能看到连接、工作区和实际预设。
- 真人发送普通任务后才新建联系人对话；发送 `/新任务` 后，下一条任务创建新对话。

## 第三部分：发布与参与开发

### 项目关系与署名

本项目使用 OneBot 11 事件接入 QQ，并推荐下列独立开源项目：

| 项目 | 关系 |
| --- | --- |
| [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | dsh 主程序与插件运行环境；必需。 |
| [NapNeko/NapCatQQ](https://github.com/NapNeko/NapCatQQ) | QQ 到 OneBot 11 的实现；必需。 |
| [botuniverse/onebot-11](https://github.com/botuniverse/onebot-11) | 本插件使用的消息协议规范。 |
| [yjh051108/dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite) | 可选且推荐的路由预设来源；未复制、修改或捆绑其源码。 |

这些项目各自采用自己的许可证和发布节奏。本项目是独立的社区插件，不代表上述项目，也不与腾讯或 QQ 官方存在隶属关系。

### 开发与测试

```bash
git clone https://github.com/riki-forsure/dsh-napcatqq-remote.git
cd dsh-napcatqq-remote
pnpm install
pnpm test
```

目录结构：

```text
lib/core.js                OneBot 消息规范化、去重和联系人队列
lib/onebot.js              WebSocket 客户端和 OneBot API
lib/channel.js             白名单、指令和联系人调度
lib/dsh-gateway.js         dsh 会话、附件、模型和 QQ 回传工具
lib/index.js               Cordis 插件入口与配置读取
scripts/build_qq_corpus.py 可选的历史语料构建脚本
test/                      Node.js 测试
config.example.json        本地配置模板
contact-style.example.md   QQ 回复语气模板
cordis.patch.yml           dsh Web profile 配置层
```

### 仓库维护者：第一次上传到 GitHub

在 GitHub 新建一个空仓库，不要勾选自动创建 README、`.gitignore` 或 License。然后在本项目目录执行：

```bash
git init
git add .
git commit -m "Initial release"
git branch -M main
git remote add origin https://github.com/riki-forsure/dsh-napcatqq-remote.git
git push -u origin main
```

上传前执行：

```bash
git status
git ls-files
```

确认没有 `config.json`、`state.json`、Token、QQ 数据库、聊天记录、真实联系人语气文件、`.qq-inbox` 或 `node_modules`。

第一次公开仓库前再完成以下检查：

1. 在 GitHub 仓库设置中填写准确的简介、主题标签，并确认仓库 URL 是 `https://github.com/riki-forsure/dsh-napcatqq-remote`。
2. 检查 `LICENSE`、`CHANGELOG.md`、`CONTRIBUTING.md` 和 `SECURITY.md` 是否随首个提交上传。
3. 等待 GitHub Actions 在 Node.js 20 和 22 上通过测试，再创建 `v0.1.3` 标签和 Release；Release 说明引用 `CHANGELOG.md`。
4. 给 `main` 开启分支保护，至少要求 CI 通过后才能合并。
5. 在提交前搜索可能泄漏的数据：

```bash
git grep -nEi '(accessToken|DSH_QQ_TOKEN|QQ_DB_KEY).*[=:].+|[1-9][0-9]{8,11}' -- . ':!README.md' ':!config.example.json'
git log --all --stat
```

搜索结果需要人工判断；测试占位 QQ 号可以保留，真实 QQ 号、Token、聊天内容和本机用户名应删除。若敏感内容曾进入提交历史，只删除当前文件不够，应在公开或继续协作前重写历史并轮换对应凭据。

### 版本发布约定

- 用户可见改动先写入 `CHANGELOG.md` 的 `Unreleased`。
- 修复向后兼容的问题增加补丁版本；新增兼容功能增加次版本；破坏配置兼容性才增加主版本。
- 发布包以 `npm pack --dry-run` 的文件列表为准；运行时数据、测试夹具中的私密数据和本地配置不得进入包。
- 上游项目只通过链接和说明署名，不复制其 README、脚本或许可证文本，除非未来确实引入其代码并按其许可证处理。

### 隐私说明

仓库中的 `.gitignore` 已排除常见运行数据，但它只能阻止尚未提交的文件。若敏感文件曾被 `git add` 或提交，需要从 Git 历史中另外清理。

本插件会把白名单联系人发来的内容交给你在 dsh 中选择的模型和工具处理。模型提供商、工具权限、工作区权限及数据留存规则由本机 dsh 配置决定。

## License

[MIT](LICENSE)
