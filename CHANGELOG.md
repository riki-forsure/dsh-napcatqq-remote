# Changelog

本项目的重要变更记录在此文件中，版本号遵循 [Semantic Versioning](https://semver.org/)。

## Unreleased

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

