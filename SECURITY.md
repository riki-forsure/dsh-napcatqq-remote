# Security Policy

## 支持范围

当前仅维护最新发布版本。使用者应同时保持 dsh、Node.js、NapCatQQ 和 QQ 客户端处于各自仍受支持的版本。

## 报告安全问题

请使用 GitHub 仓库的 **Security → Report a vulnerability** 私下提交报告，不要先创建公开 Issue。报告建议包含：

- 受影响版本和运行环境
- 最小复现步骤或演示
- 可能的影响
- 已尝试的缓解方式

请删除真实 QQ 号、Access Token、聊天内容、数据库密钥和本机路径中的用户名。维护者确认问题后会在安全公告中协调修复与披露时间。

## 部署边界

本插件只把白名单私聊交给本机 dsh，但 dsh 使用的模型和工具仍可能访问工作区或外部服务。部署者需要自行审查 dsh 的模型、工具和文件权限，并保护 NapCat OneBot WebSocket 与 Access Token。

