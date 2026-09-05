# 快速安装：dsh 与 NapCatQQ 已经可以运行

这条路线适合已经满足以下条件的用户：

- DeepSeek Harness（dsh）WebUI 能正常打开并完成普通对话；
- NapCatQQ 已登录机器人 QQ；
- NapCat 已启用 OneBot 11 WebSocket Server；
- 你会在 WSL/Linux 终端复制命令并编辑 JSON。

缺少 NapCatQQ 时改看 [`NAPCAT_SETUP.md`](NAPCAT_SETUP.md)；需要从 WSL2、Node.js 和 dsh 开始时改看 [`INSTALLATION.md`](INSTALLATION.md)；交给 Agent 时直接提供仓库地址并让它读取 [`AGENTS.md`](AGENTS.md)。

## 安装前记下三项信息

| 信息 | 示例 | 从哪里取得 |
| --- | --- | --- |
| 白名单联系人 QQ | `10001`、`10002` | 将要给机器人发消息的账号，不是机器人账号 |
| OneBot WebSocket 地址 | `ws://172.20.0.1:3001` | NapCat 网络配置和 Windows/WSL 地址 |
| OneBot Access Token | `YOUR_TOKEN` 或空 | NapCat 的 WebSocket Server 配置；不是 WebUI 登录 Token |

## 第 1 步：确认两个程序确实可用

在运行 dsh 的 WSL/Linux 终端执行：

```bash
node -v
pnpm -v
git --version
dsh --version
```

当前 DeepSeek Harness 上游支持 Node.js `^22.19.0` 或 `>=24.0.0`。如果你平时使用的是 `npx @deepseek-ai/dsh`，最后一条改成：

```bash
npx @deepseek-ai/dsh --version
```

再确认只运行一个 dsh WebUI：

```bash
ss -ltnp | grep ':3080'
```

如果 NapCat 在 Windows、dsh 在 WSL2，先测试端口，把 IP 换成你的 Windows 主机地址：

```bash
timeout 3 bash -c '</dev/tcp/172.20.0.1/3001' \
  && echo 'NapCat 端口可访问' \
  || echo 'NapCat 端口不可访问'
```

端口不可达时先看 [`NAPCAT_SETUP.md` 的连接测试](NAPCAT_SETUP.md#第-5-步从-wsl2-测试连接)，不要继续反复重启 dsh。

## 第 2 步：下载并测试插件

以下命令全部在 WSL/Linux 中执行：

```bash
cd ~
git clone https://github.com/riki-forsure/dsh-napcatqq-remote.git dsh-qq-channel
cd ~/dsh-qq-channel
pnpm install --frozen-lockfile
pnpm test
```

如果目录已经存在，不要再次克隆：

```bash
cd ~/dsh-qq-channel
git pull --ff-only
pnpm install --frozen-lockfile
pnpm test
```

测试应显示全部通过。本项目的文件/表情路径测试以 WSL/Linux 为目标环境；直接使用 Windows Node 运行测试时，`/mnt/c/...` 路径用例可能不适用。

## 第 3 步：加入 dsh Web profile

使用全局或源码环境中的 `dsh` 命令时：

```bash
cd ~/dsh-qq-channel
dsh plugin --profile web add "$PWD"
```

平时通过 npx 运行 dsh 时：

```bash
cd ~/dsh-qq-channel
npx @deepseek-ai/dsh plugin --profile web add "$PWD"
```

这是 dsh 官方的 profile 插件安装方式。该命令会读取本仓库 `package.json` 中的 `dsh.bundle` 声明，并把 `cordis.patch.yml` 加入 `web` profile。

也可以直接从 GitHub 安装：

```bash
dsh plugin --profile web add github:riki-forsure/dsh-napcatqq-remote
```

保留源码目录更方便检查、更新和运行测试，因此本文优先推荐克隆后安装。

## 第 4 步：填写最小配置

先创建本地运行目录并复制模板：

```bash
mkdir -p ~/.dsh/qq-channel
cp ~/dsh-qq-channel/config.example.json ~/.dsh/qq-channel/config.json
```

用 Windows 记事本编辑：

```bash
notepad.exe "$(wslpath -w ~/.dsh/qq-channel/config.json)"
```

或在终端编辑：

```bash
nano ~/.dsh/qq-channel/config.json
```

至少修改以下三项：

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

1. `allowedContacts` 填允许发起工作的**发送者 QQ**，不要填 NapCat 登录的机器人 QQ。
2. `websocketUrl` 填插件能够访问的 NapCat WebSocket Server 地址。
3. NapCat 配置了 OneBot Access Token 时，`accessToken` 必须完全一致；NapCat 留空时这里也留空。

QQ 号用英文双引号包围；JSON 不能写注释，最后一项后面不能多逗号。其余字段见[详细配置表](INSTALLATION.md#完整配置字段)。

先检查 JSON 语法：

```bash
node -e "JSON.parse(require('fs').readFileSync(process.env.HOME+'/.dsh/qq-channel/config.json','utf8')); console.log('config.json 语法正确')"
```

环境变量的优先级高于 JSON。以前设置过白名单时，先检查：

```bash
printenv | grep '^DSH_QQ_' || true
```

尤其是 `DSH_QQ_CONTACTS`，它会完全覆盖 `allowedContacts`。

## 第 5 步：用 QQ 验收

先检查 dsh 能组合出插件配置：

```bash
dsh --profile web --dump-config | grep -A 20 'qq-channel'
```

使用 npx 时把命令开头改为 `npx @deepseek-ai/dsh`。

配置只在 dsh 启动时读取。保存现有工作后，停止原来的唯一 dsh WebUI，再启动一次：

```bash
dsh web --host 127.0.0.1 --port 3080
```

不要同时启动第二个 `dsh web`。使用 npx 时运行：

```bash
npx @deepseek-ai/dsh web --host 127.0.0.1 --port 3080
```

然后用 `allowedContacts` 中的账号私聊机器人 QQ：

```text
/状态
```

应该收到连接状态、工作区、白名单、语气、实际 Agent 预设、视觉模型和推理强度。再发送：

```text
请在 QQ 渠道工作区新建 hello.txt，内容写“连接成功”，然后把文件发回给我。
```

验收标准：

- `/状态` 能回复；
- 第一条普通任务才在 dsh WebUI 的“QQ 渠道”中创建联系人会话；
- dsh 实际执行任务并通过 QQ 发回 `hello.txt`；
- 当前任务运行时再发“文件里再加一行当前时间”，它会调整当前工作，而不是新建并发会话；
- 发送 `/新任务` 后收到确认，下一条普通消息新建会话；旧会话仍保留。

如果 `/状态` 显示从 `router-auto` 降级到 `standard` 或 `minimal`，说明可选路由预设未安装，渠道仍然可用，不属于连接失败。

## 可选：语气和视觉表情

启用语气模板：

```bash
cp ~/dsh-qq-channel/contact-style.example.md ~/.dsh/qq-channel/contact-style.md
realpath ~/.dsh/qq-channel/contact-style.md
```

编辑复制后的文件，把 `realpath` 输出的绝对路径填入 `stylePromptFile`。默认不加载自定义语气。完整说明见[语气教程](INSTALLATION.md#第-7-步可选设置-qq-回复语气)。

使用视觉模型并希望解析 QQ NT 缓存表情时，可把 `emojiRoot` 指向机器人账号的 QQ NT 数据目录。真实路径查找与限制见[图片、文件和表情说明](INSTALLATION.md#图片文件和表情的实际支持范围)。

## 更新

```bash
cd ~/dsh-qq-channel
git pull --ff-only
pnpm install --frozen-lockfile
pnpm test
dsh plugin --profile web add "$PWD"
```

然后只重启原来的 dsh WebUI。`~/.dsh/qq-channel/`、QQ 工作区和既有会话不会因更新命令自动删除。

## 卸载

```bash
dsh plugin --profile web remove dsh-qq-channel
```

重启 dsh 后插件停止加载。卸载不会自动删除 `~/.dsh/qq-channel/`、QQ 工作区或历史会话。

## 下一步

- NapCat 连接或机器人登录有问题：[`NAPCAT_SETUP.md`](NAPCAT_SETUP.md)
- 想理解全部配置、网络和故障排查：[`INSTALLATION.md`](INSTALLATION.md)
- 想交给本地 Agent 自动完成：[`AGENTS.md`](AGENTS.md)
- 返回项目功能与 QQ 指令：[`README.md`](README.md)
