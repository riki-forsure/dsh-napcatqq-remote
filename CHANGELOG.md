# Changelog

本项目的重要变更记录在此文件中，版本号遵循 [Semantic Versioning](https://semver.org/)。

## Unreleased

### Added

- GitHub Actions 持续集成与社区协作文档。
- 人工安装和 Agent 安装两套独立指引。

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

