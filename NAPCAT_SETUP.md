# NapCatQQ 与 OneBot 11 接入教程

这条路线适合 DeepSeek Harness（DSH）已经能正常对话，但 NapCatQQ 尚未安装、尚未登录，或 OneBot 还没接好的用户。只想安装本插件可看 [`QUICKSTART.md`](QUICKSTART.md)；从 WSL、Node.js 和 DSH 开始可看 [`INSTALLATION.md`](INSTALLATION.md)。

## 先分清四个东西

```text
白名单联系人 QQ
  ↕ 私聊
机器人 QQ（登录在 NapCatQQ）
  ↕ OneBot 11 WebSocket Server
本插件
  ↕ 独立 QQ 工作区与会话
DeepSeek Harness（实际调用模型和工具）
```

- NapCatQQ 负责登录机器人 QQ，并把 QQ 消息转换成 OneBot 11 事件。
- OneBot 11 是 NapCat 与插件之间的消息/API 规范，不是另一个需要登录的软件。
- 本插件负责白名单、附件、会话与收发，不运行模型。
- DSH 负责真正读取文件、运行命令和完成工作。

`allowedContacts` 填**向机器人发送消息的人**，不是机器人 QQ。

## Shell/OneKey 与 Desktop 不是同一个界面

| 形态 | 特征 | 管理方式 | 本项目建议 |
| --- | --- | --- | --- |
| NapCatQQ Shell / Windows OneKey | 目录里有 `NapCatWinBootMain.exe`、`napcat.bat` 或 `launcher-user.bat` | 浏览器中的 NapCat WebUI，配置通常在 Shell 目录的 `config` | 新安装默认使用；自动化程度最高 |
| NapCatQQ Desktop | 独立的 Tauri 图形化管理器和 Bot 列表 | Desktop 窗口加每个 Bot 的管理页 | 已安装则保留复用，不强制迁移 |

两者能完成相同的 QQ/OneBot 桥接目标，但按钮、目录和启动方式不同。看到教程截图与本机不一样时，先确认自己属于哪一行。

## 路线 A：推荐自动安装

在仓库目录打开 Windows PowerShell：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows\install-full-stack.ps1 -AllowedContacts '联系人QQ'
```

多个联系人：

```powershell
.\scripts\windows\install-full-stack.ps1 -AllowedContacts '联系人QQ1','联系人QQ2'
```

脚本会：

1. 检测并复用现有 Shell 或 Desktop；两者同时存在时优先使用 Shell。
2. 都不存在时，从 NapCatQQ 官方最新 Release 下载 `NapCat.Shell.Windows.OneKey.zip`。
3. 解压并运行官方 `NapCatInstaller.exe`，等待它生成完整的 `NapCat.*.Shell`。
4. 准备 WSL、Node.js、DSH、本插件和推荐的 `dsh-routing-suite`。
5. 生成仅当前 Windows 用户可解密的 OneBot Token，并创建两个桌面快捷方式。
6. 把流程停在 QQ 登录/设备验证界面。

人工登录完成后，双击桌面的“启动 DSH QQ 机器人”。Shell 路线会自动识别已登录账号、写入 OneBot WebSocket Server、同步插件配置、只启动一个 DSH WebUI，并打开 `http://127.0.0.1:3080/`。

另一个快捷方式“NapCat 登录与管理”只负责打开正确的 NapCat 管理界面，不会重复启动 DSH。

### 已有 NapCat 在别的磁盘

自动检测会读取运行进程和桌面 NapCat 快捷方式。仍未找到时明确传入根目录：

```powershell
.\scripts\windows\install-full-stack.ps1 `
  -AllowedContacts '联系人QQ' `
  -NapCatRoot 'D:\Apps\NapCat.Shell'
```

脚本更新配置前会在原文件旁生成带时间戳的 `.backup-*` 副本。

## 路线 B：已有 NapCatQQ Desktop

自动安装器会识别并保留 Desktop，不会再下载 Shell。Desktop 的 Bot/OneBot 配置由管理器维护，界面名称可能随版本变化：

1. 打开桌面“NapCat 登录与管理”。
2. 添加或启动机器人 Bot，人工完成扫码、密码、设备或风控验证。
3. 打开该 Bot 的网络配置。
4. 创建 **OneBot 11 WebSocket Server**，不是 Reverse WebSocket Client。
5. 消息格式选 `array`，关闭 `reportSelfMessage`，端口使用 `3001`。
6. Host 优先填 WSL 能访问的 Windows 本机地址；同一 Windows 进程可用 `127.0.0.1`。
7. Access Token 必须和 `~/.dsh/qq-channel/config.json` 的 `accessToken` 完全一致。

Desktop 与 Shell 的状态目录不同，不要把 Shell 的 `config/onebot11_<QQ>.json` 路径套到 Desktop。交给 Agent 安装时，Agent 应通过 Desktop 实际界面完成第 3～7 步，并在 WSL 中验证 3001 端口，而不是等待一个不存在的 Shell 按钮。

## 路线 C：手动安装 Shell/OneKey

1. 打开 [NapCatQQ 官方 Releases](https://github.com/NapNeko/NapCatQQ/releases)。
2. 下载最新版本的 `NapCat.Shell.Windows.OneKey.zip`。
3. 解压到固定目录，不要直接在压缩包里运行。
4. 双击 `NapCatInstaller.exe`，等待下载与部署完成。
5. 进入生成的 `NapCat.*.Shell` 目录，运行 `napcat.bat`。
6. 在出现的 QQ 界面完成登录；WebUI 默认常见端口为 6099，但以控制台或 `config/webui.json` 为准。

普通 Shell 包（非 OneKey）通常使用 `launcher-user.bat` 或 `launcher.bat`，它依赖已安装的 QQ NT。OneKey 自带部署流程，因此文件布局不同。

### 手动建立 OneBot 11 WebSocket Server

在 Shell WebUI 的“网络配置”中添加：

| 字段 | 值 |
| --- | --- |
| 类型 | WebSocket Server |
| 名称 | `dsh-qq-channel` |
| 启用 | 是 |
| Host | WSL 默认路由所见的 Windows 地址；镜像网络可用 `127.0.0.1` |
| Port | `3001` |
| 消息格式 | `array` |
| `reportSelfMessage` | 关闭 |
| Access Token | 自己生成的随机长字符串 |

不要把 NapCat WebUI 登录 Token 当成 OneBot Access Token。前者只用于进入管理页面；本插件只使用后者。

## 从 WSL 确认地址与端口

在 WSL 中查看 Windows 主机地址：

```bash
ip route show default | awk '{print $3; exit}'
```

假设得到 `172.20.0.1`：

```bash
timeout 3 bash -c '</dev/tcp/172.20.0.1/3001' \
  && echo 'NapCat OneBot 可访问' \
  || echo 'NapCat OneBot 不可访问'
```

插件对应填写：

```json
{
  "websocketUrl": "ws://172.20.0.1:3001",
  "accessToken": "与 NapCat OneBot Server 相同的 Token"
}
```

不要把 3001 或 DSH 的 3080 端口映射到公网。自动安装器绑定 WSL 本机虚拟适配器地址，并且快捷方式始终只打开 `127.0.0.1:3080`。

## 安装插件并验收

NapCat/OneBot 就绪后按 [`QUICKSTART.md`](QUICKSTART.md) 安装插件。重启原有的唯一 DSH 进程后，用白名单联系人向机器人发送：

```text
/状态
```

再发送：

```text
在 QQ 渠道工作区新建 hello.txt，写入“连接成功”，然后把文件发回给我。
```

最后测试：

```text
/历史
/切换 1
```

`/状态` 能回复只说明 QQ 本地命令和 OneBot 链路正常；普通任务及文件回传成功，才说明 DSH 模型、工具和工作区也打通。

## 常见问题

### NapCat 已登录，但 QQ 消息没有进入 DSH

- 确认消息由 `allowedContacts` 中的发送者发给机器人。
- 确认是私聊，当前版本不处理群消息。
- 确认 OneBot 建的是 WebSocket **Server**，并已启用。
- 确认格式是 `array`、`reportSelfMessage` 已关闭。
- 从 WSL 测试实际 Host/Port，而不是只看 Windows 浏览器。
- 确认两边 OneBot Access Token 完全一致。

### 提示相同账号已经登录

同一个机器人 QQ 可能被普通 QQ NT、旧 NapCat 或另一个 Bot 实例占用。关闭重复实例，只保留准备给 NapCat 管理的登录。Shell 和 Desktop 也不要同时接管同一个账号。

### Shell WebUI 与教程截图不同

先看目录里是 `napcat.bat`、`launcher-user.bat`，还是一个 NapCatQQ Desktop 应用。OneKey Shell、普通 Shell 和 Desktop 的入口确实不同，不代表 OneBot 不受支持。

### DSH 反复显示等待 OneBot

在 WSL 中重新获取默认路由地址；NAT 网络重启后地址可能变化。再次运行“启动 DSH QQ 机器人”会重新计算地址并更新自动管理的 Shell 配置。Desktop 用户需在其网络页同步 Host。

### 表情只有编号

OneBot 事件可能只提供 `face_id` 或商城表情元数据。插件会继续查找 QQ NT 缓存；仍无真实图片时视觉模型只能看到编号/摘要。可按 [`INSTALLATION.md`](INSTALLATION.md#图片文件和表情的实际支持范围) 设置 `emojiRoot`。

## 官方项目

- [NapNeko/NapCatQQ](https://github.com/NapNeko/NapCatQQ)
- [NapCatQQ Shell 官方教程](https://napneko.github.io/guide/boot/Shell.html)
- [NapNeko/NapCatQQ-Desktop](https://github.com/NapNeko/NapCatQQ-Desktop)
- [OneBot 11](https://github.com/botuniverse/onebot-11)

NapCatQQ、NapCatQQ Desktop 与 OneBot 各自遵循其上游许可证和发布节奏；本项目只通过公开接口与它们协作。
