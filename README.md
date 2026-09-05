# 基于 NapCatQQ 的 DeepSeek Harness QQ 远程操控插件

[![CI](https://github.com/riki-forsure/dsh-napcatqq-remote/actions/workflows/test.yml/badge.svg)](https://github.com/riki-forsure/dsh-napcatqq-remote/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

`dsh-napcatqq-remote` 是一个基于 NapCatQQ / OneBot 11 的 [DeepSeek Harness（dsh）](https://github.com/deepseek-ai/deepseek-harness)远程操控插件。指定 QQ 联系人可以像平时私聊一样给家里或服务器上的 dsh 安排工作，并在 QQ 中收到处理结果。

> 这个仓库不是 QQ 客户端，也不包含模型。运行时需要三个部分：已经登录机器人 QQ 的 NapCatQQ、本插件，以及负责实际执行任务的 DeepSeek Harness。

## 已经实现的功能

- **QQ 远程工作**：只接收白名单联系人的私聊，把任务放进独立的“QQ 渠道”工作区。
- **文件双向传输**：可以接收 QQ 图片和普通文件，让 dsh 读取、修改或生成内容，再通过 `qq_send_file`、`qq_send_image` 把真实文件发回 QQ。
- **图片与表情理解**：使用 `deepseek-v4-flash-vision-exp` 等视觉模型时，可读取 OneBot 图片、文件形式的常见图片，以及能够从 QQ NT 缓存或消息中取得真实图像的 QQ 表情。
- **工作中途调整方向**：dsh 尚在执行时继续发一段话，新消息会作为补充要求加入当前任务，不会重复创建第二个并发任务。
- **长期保持同一对话**：同一联系人持续复用原 dsh 会话，上下文用尽前不会自动切换。
- **指令切换会话**：发送 `/新任务` 或 `/new` 清除当前映射，下一条普通消息自动新建一段独立对话；旧对话不会被删除。
- **多人隔离**：每个白名单联系人都有独立会话、上下文、附件目录和顺序队列，不会互相串线。
- **可选聊天语气**：可以编辑联系人语气模板；它只影响 QQ 渠道，不改变其他 dsh 工作区。
- **重启后继续**：联系人和 dsh 会话的映射会保存，正常重启后仍能接着聊。

表情识别有一个必要条件：插件必须取得真实图片数据。如果 NapCat 只提供表情编号或元数据，而且本地缓存也没有对应图片，视觉模型只能看到编号或摘要，不能看到表情画面。

## QQ 中可用的指令

| 指令 | 作用 | 是否调用模型 |
| --- | --- | --- |
| `/状态`、`/status` | 查看 OneBot 连接、白名单数量、QQ 工作区、模型、语气和实际 Agent 预设。 | 否 |
| `/新任务`、`/new` | 解除该联系人当前会话的映射；下一条普通消息才会创建新会话。 | 否 |

其他私聊文字、图片和文件都会作为工作请求交给 dsh。仅发送 `/状态` 不会提前创建对话。

## 先选择你的安装路线

| 你现在的情况 | 建议阅读 | 大致用时 |
| --- | --- | --- |
| dsh 和 NapCatQQ 都已安装、都能正常运行 | [快速安装插件](QUICKSTART.md) | 5～10 分钟 |
| dsh 已能正常对话，懂基本终端操作，但尚未安装 NapCatQQ | [NapCatQQ 安装与接入](NAPCAT_SETUP.md) | 15～30 分钟 |
| dsh、WSL2 或 NapCatQQ 还没有准备好，希望从零开始 | [从零开始详细教程](INSTALLATION.md) | 30～60 分钟 |
| 希望交给 Codex、Claude Code 等本地 Agent 安装 | [Agent 安装说明](AGENTS.md) | 先让 Agent 检查环境 |
| 已经装好但 QQ 没反应 | [按现象排查](#按现象排查) | 视问题而定 |

不确定选哪条时，从[详细教程](INSTALLATION.md)开始；每份教程顶部也能切换到其他路线。

### 推荐给 Agent 的方式

把下面整段连同仓库地址交给一个能访问本机终端的 Agent：

```text
请安装并配置 https://github.com/riki-forsure/dsh-napcatqq-remote 。
先完整读取仓库根目录 AGENTS.md，再按其中的环境检查、备份、安装和验收流程执行。
保留现有 dsh 配置、会话、工作区和运行进程；需要我登录 QQ、填写联系人 QQ 或重启 dsh 时再明确告诉我。输出中隐藏所有 Token。
```

根目录的 `AGENTS.md` 已包含环境分流、准确命令、配置字段、保留规则和验收清单，因此只给 Agent 仓库地址也能快速理解安装方式。

## 三个组件怎样配合

```text
白名单联系人发送 QQ 私聊
        ↓
机器人 QQ（登录在 NapCatQQ Desktop）
        ↓  OneBot 11 WebSocket 事件
dsh-napcatqq-remote
  ├─ 验证发送者白名单
  ├─ 保存和转换附件
  ├─ 选择联系人对应的会话
  └─ 把消息送进 QQ 渠道工作区
        ↓
DeepSeek Harness（模型、Agent、工具、工作区与会话）
        ↓
插件组织文字/图片/文件/表情回复
        ↓
NapCatQQ 发回原联系人
```

| 组件 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| **NapCatQQ** | 登录机器人 QQ，把 QQ 消息转换为 OneBot 11 事件，并执行发送消息接口。 | 不运行模型，也不处理工作任务。 |
| **本插件** | 连接 OneBot、校验白名单、管理附件和联系人会话、把结果发回 QQ。 | 不替代 QQ、NapCatQQ 或 dsh。 |
| **DeepSeek Harness（dsh）** | 调用模型和工具，在指定工作区真正读取文件、运行命令并完成任务。 | 不直接登录 QQ。 |

### 机器人 QQ 与白名单联系人

配置里涉及两类 QQ 号：

| 名称 | 是谁 | 填在哪里 |
| --- | --- | --- |
| 机器人 QQ | NapCatQQ 中登录、负责收发消息的账号 | 通常自动识别；需要时填 `botSelfId` |
| 白名单联系人 | 给机器人发消息、希望使用 dsh 的发送者 | 必须填入 `allowedContacts` |

`allowedContacts` 填消息发送者，不是机器人自己的 QQ 号。

## 日常使用

### 会话和工作方向

- 白名单只决定谁能发起任务，不会提前建立会话。
- 联系人第一次发送普通消息时，插件才在“QQ 渠道”工作区创建对话。
- 同一联系人之后的普通消息持续使用这一对话。
- 当前任务仍在运行时，新消息通过 dsh 的 steer 能力补充到当前任务。
- 发送 `/新任务` 后只是解除映射；下一条普通消息才新建对话。
- 旧会话和文件不会被 `/新任务` 删除，仍可从 dsh WebUI 查看。

当前版本没有“通过 QQ 指定并恢复任意旧会话”的指令。需要查看旧对话时请使用 dsh WebUI。

### 文件、图片与 QQ 表情

- 收到的普通文件保存在该联系人的 `.qq-inbox` 范围内，模型可按权限读取和处理。
- 图片会作为 dsh 原生图片附件交给视觉模型，而不是只把本地路径写进提示词。
- Agent 可调用 `qq_send_file`、`qq_send_image`、`qq_send_face`、`qq_send_mface` 回传真实内容。
- OneBot `face` 会保留表情编号，并尽量从 QQ NT 本地缓存解析图片。
- `mface` / `marketface` 会保留商城表情的 ID、包 ID、key 和摘要；只有拿到图片时才交给视觉模型。
- 当前图片回传支持 PNG、JPEG、WebP 和 GIF；单张图片默认不超过 20 MiB，普通附件默认不超过 50 MiB。

### 默认语气与自定义模板

默认 `stylePromptFile` 为空，因此插件不会自动模仿任何联系人。回复语气来自实际选中的 dsh Agent 预设，通常以直接完成任务、清楚汇报结果为主。

启用自定义语气时，把 [`contact-style.example.md`](contact-style.example.md) 复制到：

```text
~/.dsh/qq-channel/contact-style.md
```

修改复制后的文件，再把它的绝对路径写入 `config.json` 的 `stylePromptFile`。模板适合填写称呼、长短、语气词、标点习惯、汇报方式和对话示例。详细步骤见[完整安装教程的语气章节](INSTALLATION.md#第-7-步可选设置-qq-回复语气)。

### Agent 预设与可选路由插件

默认候选顺序是：

```text
router-auto → router-standard → standard → minimal
```

`router-auto` 是 Agent 预设名称，不是模型名称。[dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite) 是独立、可选且推荐的开源预设套件，可提供 `router-standard` 等路由预设；本仓库没有复制或捆绑它。即使没有安装，插件也会回退到 dsh 自带的 `standard` 或 `minimal`，QQ 渠道仍可工作。

## 默认数据位置

```text
~/.dsh/qq-channel/
├── config.json          本地连接、白名单、模型和语气配置
├── contact-style.md     可选语气模板
└── state.json           联系人与 dsh 会话的映射

~/dsh-work/qq-channel-workspace/
├── .qq-inbox/<联系人QQ>/          收到的普通文件
└── corpus/live/<联系人QQ>/
    └── dialogue.jsonl             QQ 渠道实时对话语料
```

图片正文由 dsh attachment 服务保存。配置、Token、QQ 号、聊天记录、附件和语料都属于本地运行数据，不应提交到 GitHub。

## 已知范围

- 当前只处理白名单联系人的 QQ 私聊；群聊和机器人自身消息会被忽略。
- dsh 与 NapCatQQ 必须同时运行，插件本身不能登录 QQ。
- 修改 `config.json` 或语气文件后，需要完整重启 dsh 才会重新读取。
- 图片和表情理解取决于 NapCat/QQ 缓存是否提供真实图片，以及所选模型是否支持视觉。
- DeepSeek Harness 目前仍处于开发者预览阶段，升级 dsh 后若出现插件 API 兼容问题，请先查看本仓库 Release 和 Issue。

## 按现象排查

| 现象 | 先检查 | 详细位置 |
| --- | --- | --- |
| QQ 消息完全没有回复 | 发送者白名单、机器人在线、NapCat WS、IP/端口、Access Token | [分层故障排查](INSTALLATION.md#分层故障排查) |
| `/状态` 能回复，普通任务不回复 | dsh WebUI 的模型、提供商 ID、实际预设和任务状态 | [dsh 与模型层](INSTALLATION.md#第四层deepseek-harness模型和-agent) |
| dsh 显示等待 OneBot | NapCat 使用的是 WebSocket Server，不是反向 WS；端口从 WSL 可达 | [NapCat 连接测试](NAPCAT_SETUP.md#第-5-步从-wsl2-测试连接) |
| 两个白名单账号都没有反应 | JSON 数组、`DSH_QQ_CONTACTS` 环境变量覆盖、重启是否完成 | [插件层排查](INSTALLATION.md#第三层插件配置与会话) |
| 第二个联系人没有出现在 `state.json` | 它是否发过普通任务；仅 `/状态` 不创建会话 | [会话验证](QUICKSTART.md#第-5-步用-qq-验收) |
| WebUI 慢或启动后不跳转 | 是否启动了多个 `dsh web` 抢占 3080 | [dsh 层排查](INSTALLATION.md#第四层deepseek-harness模型和-agent) |
| 表情只能看到编号 | 消息或 QQ NT 缓存是否存在真实图片，`emojiRoot` 是否正确 | [图片与表情配置](INSTALLATION.md#图片文件和表情的实际支持范围) |

## 项目关系与署名

| 项目 | 与本项目的关系 |
| --- | --- |
| [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | DeepSeek Harness 主程序与插件运行环境；必需。 |
| [NapNeko/NapCatQQ](https://github.com/NapNeko/NapCatQQ) | QQ 到 OneBot 11 的实现；必需。 |
| [NapNeko/NapCatQQ-Desktop](https://github.com/NapNeko/NapCatQQ-Desktop) | 推荐给 Windows 用户的 NapCatQQ 图形化安装方式。 |
| [botuniverse/onebot-11](https://github.com/botuniverse/onebot-11) | 本插件使用的消息和接口规范。 |
| [yjh051108/dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite) | 可选且推荐的路由预设来源；未复制、修改或捆绑其源码。 |

这些项目分别遵循自己的许可证和发布节奏。本项目是独立社区插件，不代表上述项目，也不与腾讯或 QQ 官方存在隶属关系。

## 开发与发布

```bash
git clone https://github.com/riki-forsure/dsh-napcatqq-remote.git
cd dsh-napcatqq-remote
pnpm install --frozen-lockfile
pnpm test
```

贡献、问题报告和安全说明分别见 [`CONTRIBUTING.md`](CONTRIBUTING.md) 与 [`SECURITY.md`](SECURITY.md)。版本变化见 [`CHANGELOG.md`](CHANGELOG.md)。

## License

[MIT](LICENSE)
