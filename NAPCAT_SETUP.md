# NapCatQQ 安装与接入：已有 dsh，但还没安装 NapCat

这条路线适合 DeepSeek Harness（dsh）WebUI 已经能正常对话、也会使用基本终端命令，但还没有安装 NapCatQQ 的用户。

如果 NapCat 和 dsh 都已运行，直接看 [`QUICKSTART.md`](QUICKSTART.md)；需要从 WSL2、Node.js 和 dsh 一起安装时看 [`INSTALLATION.md`](INSTALLATION.md)；让本地 Agent 安装时让它先读 [`AGENTS.md`](AGENTS.md)。

## 先理解 NapCat 与插件的关系

NapCatQQ 负责登录一个“机器人 QQ”，并把私聊转换成 OneBot 11 消息。插件作为 WebSocket 客户端连接 NapCat，将白名单联系人的消息送入 dsh，再调用 NapCat 的 OneBot 接口把结果发回。

```text
联系人 QQ
  ↕ QQ 私聊
机器人 QQ（NapCatQQ Desktop）
  ↕ OneBot 11 WebSocket，默认 3001
本插件
  ↕ dsh 会话、附件和工具
DeepSeek Harness
```

NapCat 本身不运行模型；本插件本身也不登录 QQ。两个程序必须同时在线。

## 准备清单

- Windows 10 / 11 x64；NapCatQQ Desktop 上游也支持 Windows Server 2016+ x64。
- 一个用于机器人的 QQ 账号。
- 另一个将要发消息的联系人 QQ 账号。
- 已能运行并正常对话的 dsh WebUI。
- 如果 dsh 在 WSL2，需要允许 WSL 访问 Windows 上的 NapCat 端口。

机器人 QQ 和白名单联系人可以互相正常私聊。`allowedContacts` 最终填写联系人账号，不填写机器人账号。

## 第 1 步：下载正确的 NapCatQQ Desktop

1. 在 Windows 浏览器打开 [NapCatQQ Desktop 官方 Releases](https://github.com/NapNeko/NapCatQQ-Desktop/releases)。
2. 打开标记为 Latest 的 NapCatQQ Desktop 版本。
3. 下载名称类似 `NapCatQQ-Desktop-<版本>-x64.msi` 的文件；`NapCatQQ-Desktop-x64.msi` 是同类安装包。
4. 不要下载名称含 `watch-v` 的文件，它是远端监控工具，不是桌面安装包。
5. 双击 MSI，按安装向导完成安装并启动。

官方项目会持续更新，因此这里不锁定某个版本号。始终从官方 Releases 选择最新的版本化 x64 MSI。NapCatQQ Desktop 的本地数据通常位于：

```text
%ProgramData%\NapCatQQ Desktop
```

## 第 2 步：添加并登录机器人 QQ

1. 打开 NapCatQQ Desktop。
2. 按界面提示添加或启动一个 Bot。
3. 使用准备好的机器人 QQ 完成扫码、密码或设备验证。
4. 等待 NapCat 显示机器人在线。
5. 记下 NapCat WebUI 地址以及进入 WebUI 所需的登录 Token。

首次登录可能需要人工完成 QQ 风控或设备确认，这一步由账号持有人操作。普通 QQ 聊天窗口中看到在线，不代表 OneBot WebSocket 已经开启，还需要下一步网络配置。

## 第 3 步：新建 OneBot 11 WebSocket Server

打开 NapCat WebUI，进入“网络配置”。不同版本的按钮名称可能略有差异，目标是创建 **OneBot 11 WebSocket 服务端 / WebSocket Server**，不是反向 WebSocket 客户端。

建议填写：

| NapCat 配置项 | dsh 在 WSL2 时 | NapCat 与 dsh 同一 Windows 环境时 |
| --- | --- | --- |
| 类型 | WebSocket Server | WebSocket Server |
| 启用 | 开启 | 开启 |
| Host / 主机 | `0.0.0.0` | `127.0.0.1` |
| Port / 端口 | `3001` | `3001` |
| 消息格式 | `array` | `array` |
| `reportSelfMessage` | 关闭 | 关闭 |
| Access Token | 建议设置随机长字符串 | 建议设置随机长字符串 |

保存后确认这条配置处于启用状态。若 NapCat 提供“重载网络配置”或要求重启 Bot，按界面提示操作。

### 两种 Token 不要混淆

- **NapCat WebUI 登录 Token**：只用于打开管理页面。
- **OneBot Access Token**：用于插件连接 WebSocket Server，必须与插件 `config.json` 的 `accessToken` 完全一致。

本插件只使用 OneBot Access Token。把 WebUI Token 填进插件会导致连接鉴权失败。

## 第 4 步：处理 Windows 防火墙

如果 Windows 首次弹出防火墙提示：

1. 允许 NapCatQQ Desktop 或对应 NapCat 进程通信；
2. 只勾选“专用网络”；
3. 不需要为了本插件开放公用网络。

若错过弹窗，在 Windows“防火墙和网络保护 → 允许应用通过防火墙”中允许 NapCat 的专用网络访问。

`0.0.0.0:3001` 表示监听本机所有接口，是为了让 WSL2 能访问。不要在路由器上做端口转发，也不要把 3001 直接暴露到公网。

## 第 5 步：从 WSL2 测试连接

如果 dsh 在 WSL2，先取得 Windows 主机地址。在 WSL Ubuntu 中执行：

```bash
ip route show default | awk '{print $3; exit}'
```

例如返回：

```text
172.20.0.1
```

对应的插件地址是：

```text
ws://172.20.0.1:3001
```

测试 TCP 端口：

```bash
timeout 3 bash -c '</dev/tcp/172.20.0.1/3001' \
  && echo 'NapCat 端口可访问' \
  || echo 'NapCat 端口不可访问'
```

把命令中的 IP 换成实际输出。显示“端口可访问”后再安装插件。

在启用 WSL 镜像网络的系统上，`ws://127.0.0.1:3001` 可能也能使用；以实际端口测试结果为准。WSL 每次重启后默认网关地址可能变化，地址突然失效时重新执行查询命令。

## 第 6 步：安装插件并填写 NapCat 地址

继续按 [`QUICKSTART.md`](QUICKSTART.md) 安装插件。需要填入的关键内容是：

```json
{
  "allowedContacts": ["CONTACT_QQ"],
  "websocketUrl": "ws://WINDOWS_HOST:3001",
  "accessToken": "ONEBOT_ACCESS_TOKEN"
}
```

- `CONTACT_QQ`：发送工作消息的联系人 QQ。
- `WINDOWS_HOST`：上一节查到的 Windows 主机地址。
- `ONEBOT_ACCESS_TOKEN`：NapCat WebSocket Server 中设置的 Access Token；两边都留空也能连接，但绑定 `0.0.0.0` 时建议设置。

完整配置不要只保留这三个字段；请复制仓库中的 `config.example.json`，再修改对应值。

## 第 7 步：验证完整链路

1. 确认 NapCat 中机器人状态在线。
2. 确认 OneBot 11 WebSocket Server 已启用。
3. 确认 WSL 端口测试成功。
4. 安装并配置本插件。
5. 只重启原来的 dsh WebUI 一次。
6. 从白名单联系人 QQ 向机器人 QQ 发送 `/状态`。

成功时，NapCat 日志会出现收到私聊/OneBot 事件，dsh 日志会显示 QQ 渠道连接，QQ 会收到状态回复。

再发送普通任务：

```text
回复当前 QQ 渠道工作区路径，并新建一个 test.txt 发给我。
```

只有这条普通消息才会创建联系人对应的 dsh 会话。

## NapCat 层常见问题

### NapCat 登录了，但 QQ 消息完全没有进入 dsh

按顺序检查：

1. 私聊的接收方是否真的是 NapCat 登录的机器人 QQ。
2. NapCat 中 Bot 是否显示在线。
3. 网络配置是否是 WebSocket **Server**，不是 Reverse WebSocket。
4. 配置是否启用、端口是否为 3001、消息格式是否为 `array`。
5. WSL 中能否访问 Windows 主机的 3001 端口。
6. NapCat 与插件的 OneBot Access Token 是否逐字一致。
7. 防火墙是否允许专用网络连接。

### dsh 日志反复显示 WebSocket 重连

- `ECONNREFUSED`：地址能到达，但 3001 没有服务监听；检查 NapCat 网络配置是否启用。
- 连接超时：通常是 Windows 主机 IP 或防火墙问题。
- 401 / 鉴权失败：两边 Access Token 不一致，或者误填了 WebUI Token。
- 连接成功后立刻断开：检查 NapCat 日志、消息格式，并升级到官方当前稳定版。

### NapCat 能收到消息，但插件忽略

- 发送者 QQ 是否填入 `allowedContacts`。
- 是否误把机器人 QQ 填进白名单。
- 是否在群聊测试；当前插件只处理私聊。
- 是否存在 `DSH_QQ_CONTACTS` 环境变量覆盖 JSON。
- 消息是否由机器人账号自己发出；自身消息默认忽略。

### NapCat 提示相同账号已经登录

确认同一个机器人 QQ 是否同时被普通 QQ NT、另一个 NapCat 实例或旧 Bot 进程占用。停止重复实例后，只保留 NapCatQQ Desktop 管理的那个 Bot，再按 NapCat 页面提示重新登录。

### 表情只有编号，没有图片

OneBot 事件可能只携带 `face_id` 或商城表情元数据。本插件会继续尝试机器人账号的 QQ NT 缓存；仍找不到图片时模型只能看到编号/摘要。可在插件配置中设置 `emojiRoot`，详细见 [`INSTALLATION.md`](INSTALLATION.md#图片文件和表情的实际支持范围)。

## 安全和维护提示

- 不要公开 OneBot Access Token、NapCat WebUI Token、机器人 QQ 登录凭据或二维码。
- 不要把 3001 端口映射到公网。
- NapCatQQ Desktop 更新前先在其界面停止 Bot，更新完成后再启动。
- NapCat、QQ 和 dsh 都可能更新；升级后先分别验证 Bot 在线、端口可达和 dsh 普通对话，再检查插件。
- NapCat 的实际按钮和字段以[官方文档](https://napneko.github.io/)与[官方 Releases](https://github.com/NapNeko/NapCatQQ-Desktop/releases)为准。

## 下一步

- NapCat 已经连通：继续 [`QUICKSTART.md`](QUICKSTART.md)
- 发现 dsh 环境也没有准备好：改看 [`INSTALLATION.md`](INSTALLATION.md)
- 交给本地 Agent：让它从 [`AGENTS.md`](AGENTS.md) 开始
- 返回功能、QQ 指令和架构：[`README.md`](README.md)
