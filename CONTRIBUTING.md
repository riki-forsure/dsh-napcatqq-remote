# 参与贡献

感谢改进 dsh QQ Channel。提交代码前，请先确认问题可以在不包含真实 QQ 数据的环境中复现。

## 开发环境

- Node.js 20 或更高版本
- pnpm
- Git

```bash
git clone https://github.com/riki-forsure/dsh-napcatqq-remote.git
cd dsh-napcatqq-remote
pnpm install --frozen-lockfile
pnpm test
```

## 提交改动

1. 从 `main` 新建说明用途的分支。
2. 为行为变更补充或更新测试，保持测试用 QQ 号、Token 和路径为虚构占位值。
3. 运行 `pnpm test` 和 `npm pack --dry-run`。
4. 在 `CHANGELOG.md` 的 `Unreleased` 中记录用户可见变更。
5. 提交 Pull Request，说明动机、行为变化、验证方式和兼容性影响。

请保持一个 Pull Request 聚焦一个主题。不要提交 `config.json`、`state.json`、聊天记录、QQ 数据库、附件、真实语气模板、访问 Token 或本机用户名路径。

## 报告问题

普通缺陷可提交 GitHub Issue，并附上已脱敏的 dsh 版本、插件版本、系统环境、复现步骤和日志片段。涉及凭据泄漏或可被利用的安全问题，请按 [SECURITY.md](SECURITY.md) 私下报告。
