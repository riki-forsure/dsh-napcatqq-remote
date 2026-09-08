# QQ 选项、历史会话与全栈安装设计

## 目标

本次改动同时解决三个相互关联的问题：

1. DeepSeek Harness（dsh）在 QQ 渠道会话中调用 WebUI 专用的 `ask_user_question` 时，任务会等待 WebUI 回答，但 QQ 联系人看不到问题和选项，因而误以为任务卡住。
2. QQ 联系人只能新建会话，不能查看或恢复自己的历史会话。
3. 仓库把 NapCatQQ Shell/OneBot 与 NapCatQQ Desktop 混写为同一套安装界面，导致 Agent 在安装 Bot 组件时缺少可执行步骤，不能把整套环境交付到只需用户登录的状态。

完成后，QQ 联系人能看到普通文本形式的编号选项，能查看和切换自己的历史会话；本地 Agent 能自动安装或复用 DSH、NapCatQQ、OneBot 和本插件，并在桌面留下日常启动及登录管理入口。

## 范围和约束

- 只支持白名单私聊；历史会话继续按联系人隔离。
- 不删除旧会话、附件、状态、语气文件、模型配置或现有 NapCat 配置。
- 不用 QQ 指令切换到其他联系人的会话。
- 不在任务运行中切换会话。
- 不在本次安装代码更新后重启当前运行中的 dsh。源码和本机已安装插件会更新，下次用户正常重启后生效。
- 新安装默认使用 NapCatQQ Shell Windows OneKey；检测到已有 Shell 或 Desktop 时优先复用，绝不为统一界面而覆盖已有安装。
- QQ 扫码、密码、设备验证和风控确认必须由账号持有人在登录界面完成；除此之外的下载、配置、连通和快捷方式创建应可由 Agent 自动完成。

## 方案选择

### QQ 选项

选择“QQ 会话禁用 WebUI 交互工具，使用普通消息提问”。在 QQ Agent 作用域中通过 `agentCtx.tools.restrict({ deny: ["ask_user_question"] })` 隐藏 WebUI 专用工具，并在系统提示中要求需要选择时输出普通文本、编号选项和回复方法，然后结束本轮。联系人下一条 QQ 消息作为普通用户消息进入同一会话，模型结合上下文继续任务。

不实现全局 `userQuestions` Provider 替换。该服务只有一个活动 Provider，替换会影响 WebUI 任务；轮询工具调用也依赖内部事件形状，兼容性更差。

### 历史会话

选择“联系人隔离的编号列表＋完整 ID 备用”。`/历史` 读取 `sessionPersistence.list()`，只保留：

- 会话 ID 以 `session-qq-<当前联系人>-` 开头；
- `cwd` 与 QQ 渠道工作区一致；
- 非 subagent 子会话。

结果按创建时间倒序排列，默认显示最近 10 个。插件对每个联系人缓存最近一次列表中的会话 ID，因此 `/切换 2` 始终指向用户刚看到的第 2 项。`/切换 <完整会话ID>` 作为精确备用方式，但仍执行相同的联系人及工作区校验。

### NapCat 安装

选择“自动识别＋新装默认 Shell”：

1. 检测 NapCatQQ Shell、NapCatQQ Desktop、QQ NT、WSL2、dsh 和现有插件。
2. 已有 Shell 时沿用 Shell 配置和启动器。
3. 只有 Desktop 时沿用 Desktop，文档和 Agent 操作使用 Desktop 对应界面。
4. 两者都没有时，从 NapCatQQ 官方最新稳定 Release 动态选择 `NapCat.Shell.Windows.OneKey.zip`，不硬编码版本号。
5. 所有下载地址必须来自 NapCat 官方 GitHub Release/API；忽略预发布和其他仓库资产。

Shell 默认路线与当前本机环境一致，能使用确定的批处理入口和 `onebot11_<机器人QQ>.json` 文件，适合 Agent 自动配置。Desktop 保留为受支持的人工路线，但不再假定它与 Shell 有同样的按钮和目录。

## QQ 选项数据流

1. QQ Agent 组合预设后，插件在该 Agent 的工具作用域隐藏 `ask_user_question`。
2. 插件注入渠道规则：需要确认或选择时，直接发送普通助手文本；选项使用 `1.`、`2.` 等编号，并说明可回复编号或自定义内容。
3. 本轮成为普通完成状态，`finishRun()` 能从会话中提取助手文本并发送到 QQ，不再无限等待 WebUI Provider。
4. 联系人的下一条消息进入同一 session，模型从已持久化的问题和回答继续。

若当前 dsh 版本没有 `tools.restrict`，插件仅注入文本规则并记录警告，保持旧版本兼容；测试需覆盖两条路径。

## 历史会话接口

### `/历史` 与 `/history`

返回格式示例：

```text
你的 QQ 历史对话（最近 3 个）：
1. [当前] 09-09 14:20 继续处理安装文档
2. 09-08 21:03 修复图片识别
3. 09-04 18:11 首次配置插件

发送 /切换 2 切换；发送 /新任务 新建。
```

标题优先读取 `session/title` 事件；没有标题时读取第一条用户文本并截断；仍无文本时显示会话 ID 的短尾部。读取单个会话失败不影响列表，其标题显示为“标题读取失败”。

### `/切换 <编号或完整会话ID>` 与 `/switch ...`

- 没有参数：返回用法。
- 编号：必须先成功执行 `/历史`，且编号在缓存列表范围内。
- 完整 ID：必须属于当前联系人和 QQ 工作区，并存在于持久化列表。
- 当前任务运行中：拒绝切换并提示任务完成后重试。
- 目标就是当前会话：回复“已经在该对话中”。
- 成功：保存新的联系人映射，释放插件拥有的旧空闲 Agent handle；下一条普通消息按需恢复目标会话。
- 任何失败都不修改当前映射。

历史列表缓存仅用于编号解析，不写入 `state.json`；重启后重新发送 `/历史` 即可。

## 全栈安装器

仓库新增 Windows PowerShell 入口和配套 WSL 脚本。脚本必须可重复执行，并对已安装环境执行合并而非覆盖。

### 自动安装阶段

1. 检查 Windows 版本、体系结构、网络、QQ NT、NapCat 形态、WSL 发行版和 dsh 进程。
2. 在写入前备份将修改的 NapCat OneBot 配置、`~/.dsh/qq-channel/config.json`、profile 依赖和已有桌面快捷方式。
3. 若没有 NapCat：动态下载官方最新稳定 Shell OneKey 包，解压到当前用户可写的固定目录。
4. 若缺少 WSL2/Ubuntu：调用 Windows 官方 WSL 安装命令；需要重启时清楚报告，并生成可再次执行的续装入口。
5. 在 WSL 中安装符合 dsh 要求的 Node.js、pnpm 和 Git，安装 dsh，克隆本仓库，运行测试并添加到同一 `web` profile。
6. 获取或生成 OneBot Access Token，写入 dsh 插件配置；Token 不输出到普通日志。
7. 启动 NapCat 登录与管理入口，把扫码或设备验证交给用户。

### 登录后完成阶段

Shell 路线检测 `config/napcat_<QQ>.json` 或已登录账号列表，确定机器人 QQ 后：

1. 原子写入或合并 `config/onebot11_<QQ>.json`，创建启用的 OneBot 11 WebSocket Server。
2. 选择 dsh 可访问的监听地址：同一 Windows 环境优先 `127.0.0.1`；WSL NAT 环境绑定实际 WSL 可达的 Windows 接口；不在路由器或公网开放端口。
3. 将完全一致的 WebSocket 地址和 Token 写入 `~/.dsh/qq-channel/config.json`。
4. 验证 JSON、端口、profile 组合和单一 dsh 进程条件。

Desktop 路线不复用 Shell 的文件路径。Agent 使用 Desktop 自带组件与 Bot 管理流程，并根据 Desktop 实际生成的 NapCat 运行目录定位 OneBot 配置；文档把所有 Desktop 特有操作放在独立章节。

### 桌面快捷方式

生成两个入口：

- `启动 DSH QQ 机器人`：检测并启动现有 NapCat 形态；若登录后 OneBot 尚未完成则先运行完成阶段；只在 3080 未被现有 dsh 占用时启动用户原有 dsh 命令；最后打开 dsh WebUI。
- `NapCat 登录与管理`：只启动 NapCat 登录/管理入口。Shell 打开本地 NapCat WebUI 登录页；Desktop 打开 Desktop 管理器。

启动器必须隐藏不必要的命令窗口、记录可读日志、避免重复进程，并配套保留已有“停止 DeepSeek Harness”功能。快捷方式不保存明文 Token。

## Agent 安装契约

`AGENTS.md` 改为可执行分流协议，而不是只给人工说明：

- 先检测再选择 Shell、Desktop 或新装 Shell 路线。
- 明确可自动完成的步骤和唯一人工暂停点：QQ 登录验证。
- Agent 在暂停前必须已经安装其他组件、准备配置模板并创建两个桌面入口。
- 用户登录后，Agent 继续执行完成阶段；若 Agent 会话已经结束，用户运行“启动 DSH QQ 机器人”也会完成剩余配置。
- Agent 不猜机器人 QQ、白名单联系人、模型 Provider/Model；缺值时一次只询问必要信息。
- 最终报告区分“静态安装完成”“等待登录”“OneBot 已连通”“QQ 端到端已验证”。

## 人工文档结构

- `README.md`：增加 QQ 新指令、选项行为、两种 NapCat 的区别和安装路线选择器。
- `QUICKSTART.md`：已有 NapCat 和 dsh 时的最短插件更新流程。
- `NAPCAT_SETUP.md`：拆为 Shell 与 Desktop 两章，Shell 为推荐自动化路线；不再混用按钮或目录。
- `INSTALLATION.md`：从零路线优先调用全栈安装器，同时保留逐步人工操作；明确登录后的完成步骤和桌面快捷方式。
- `AGENTS.md`：Agent 自动安装契约及可执行命令。
- `CHANGELOG.md`：记录选项显示、历史切换、安装器和文档修复。

## 测试

### 插件测试

- QQ Agent 存在 `tools.restrict` 时隐藏 `ask_user_question`。
- 旧 dsh 替身没有 `tools.restrict` 时仍可创建 Agent。
- `/历史` 只显示当前联系人、当前工作区的顶层 QQ 会话。
- 标题读取、回退标题、排序和 10 条限制。
- `/切换 2`、完整 ID、越界编号、未先列表、跨联系人、错误工作区、目标不存在和当前会话。
- 运行中切换被拒绝且映射不变。
- 成功切换持久化映射，并在下一条消息恢复目标会话。
- 现有消息、附件、多人隔离、新任务和预设回退测试继续通过。

### 安装器测试

- PowerShell 语法检查和参数校验。
- 使用临时目录模拟：无 NapCat、已有 Shell、已有 Desktop、二者都有、已有用户配置、WSL 需要续装。
- GitHub Release 解析只接受官方稳定资产。
- OneBot 与 dsh 配置原子合并，不泄露 Token，不覆盖无关字段。
- 快捷方式目标、参数、幂等启动和进程检测。
- 不在自动测试中启动或停止用户当前 dsh；端到端登录与 QQ 消息由用户下一次正常重启后验证。

## 交付与发布

实现时先修改并测试 GitHub 工作副本，再把相同的有意代码改动合并到 `/home/riki/.dsh/plugins/dsh-qq-channel`。本机定制的工作区、人格文件、表情路径和启动配置继续保留。完成后提交并推送 GitHub，但不重启当前 dsh，也不声称运行中的进程已经加载新代码。

