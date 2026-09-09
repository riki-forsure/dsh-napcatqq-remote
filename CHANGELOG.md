# Changelog

本项目的重要变更记录在此文件中，版本号遵循 [Semantic Versioning](https://semver.org/)。

## Unreleased

## 0.2.0 - 2026-09-09

### Added

- `/历史`、`/history`、`/切换` 与 `/switch`，按联系人隔离地查看最近 10 段 QQ 会话并恢复指定历史。
- QQ Agent 工具限制与提示词回退：需要用户选择时发送普通编号文字，不再等待 WebUI 独占的 `ask_user_question` 弹窗。
- Windows 全栈安装器，自动检测 NapCatQQ Shell/OneKey 与 NapCatQQ Desktop，准备 WSL、Node.js、DeepSeek Harness、OneBot、本插件和桌面快捷方式。
- DSH 版本检查器：保留兼容旧版，全新或过旧环境使用 npm `latest` 稳定标签，不直接追随 GitHub 主分支快照。
- “启动 DSH QQ 机器人”和“NapCat 登录与管理”两个桌面入口；前者避免重复启动 DSH。
- PowerShell 夹具测试，覆盖 NapCat 形态检测、OneBot 配置幂等、配置保留、Token 保护和快捷方式定义。

### Changed

- 新安装默认使用 `router-standard`；自动安装与 Agent 流程在缺少时安装 `dsh-routing-suite`，同时保留 DSH 内置 `standard`/`minimal` 降级链。
- 人工教程和 Agent 合约明确区分 NapCatQQ Shell/OneKey 与 NapCatQQ Desktop 的界面、启动器及配置路径。
- 自动管理的 OneBot Server 绑定当前 WSL 可达的 Windows 本机地址，DSH WebUI 继续仅监听 `127.0.0.1:3080`。
- 更新现有配置时保留自定义语气、模型、预设和其他未知字段，并在实际变化前创建备份。
- DSH peer dependency 改为可选并覆盖 `0.1.0-rc.6` 至 `0.1.x`；源码安装在加入 profile 前清除测试依赖，避免宿主与插件各加载一套不兼容 API。
- DSH 兼容层不再静态绑定某个旧版 `dsh-agent`/`dsh-llm`；可选模型选择接口缺失时回退到 Agent 创建参数。

## 0.1.4 - 2026-09-05

### Added

- 按环境分流的安装入口：插件快速安装、NapCatQQ 单独接入和从零开始详细教程。
- 根目录 `AGENTS.md`，让本地 Agent 仅凭仓库地址即可检查环境、保护现有数据并完成安装验收。
- README 首屏功能清单、QQ 指令表和 NapCatQQ / 插件 / DeepSeek Harness 组件关系图。
- DeepSeek Harness 当前运行环境、模型和工作区设置，以及 NapCatQQ Desktop、OneBot WebSocket、防火墙和 WSL2 网络说明。

### Changed

- 将原来的单页长教程拆分成由 README 引导的多条安装路线。
- 明确视觉模型只有取得真实图片数据时才能理解 QQ 表情，并补充插件支持范围与分层故障排查。
- 明确 `dsh-routing-suite` 为可选增强；未安装时继续使用 dsh 内置 `standard` 或 `minimal`。

## 0.1.3 - 2026-09-04

### Added

- QQ 私聊白名单、联系人独立会话和独立工作区。
- `/状态`、`/新任务` 与任务运行中追加消息。
- 文字、图片、文件、QQ 内置表情和商城表情的收发支持。
- 可选联系人语气模板与历史聊天语料构建脚本。
- `router-auto → router-standard → standard → minimal` 预设候选链。

### Changed

- 启动时检查 Agent 预设健康状态，`/状态` 显示实际预设及降级信息。
- 旧会话依赖的预设消失时保留原会话，新建使用可用预设的会话。

