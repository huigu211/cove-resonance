# iPad + Render 免费实例：私人一起听

此分支在公开的 Cove Resonance 基础上增加一个手机可用的扫码页面和单人 OAuth 访问保护。Render 托管 Bridge，iPad 用 ChatGPT 和网易云 App；不需要另外的 VPS 或电脑常开。

## 部署

用本仓库的 Dockerfile 部署 Render Web Service（Free）。在 Render 的 **Environment** 中设置：

| 名称 | 值 |
| --- | --- |
| `BRIDGE_PUBLIC_ORIGIN` | 你的 `https://...onrender.com` 域名，不带 `/mcp` |
| `BRIDGE_OWNER_SECRET` | 自己生成的至少 32 字符随机密钥。只在 Render 后台输入，绝不发到聊天或提交 Git。 |
| `TOGETHER_ENABLED` | `false`；扫码确认后本次运行自动启用。 |

不要在 Render 中填写 `NETEASE_COOKIE`。登录信息只保存在正在运行的服务进程内；免费服务休眠、重新部署或重启后，需要再次扫码。不要截图展示密钥或已揭开的环境变量值。

## 扫码与连接

1. 在 iPad 浏览器打开 `https://你的域名/login`，输入专属密钥。
2. 用**备用网易云账号**所在的手机 App 扫描 iPad 上的二维码，并在手机上确认。页面只显示是否完成，不返回 Cookie。
3. 在 ChatGPT 中连接 `https://你的域名/mcp/music`，OAuth 页面再次输入同一个专属密钥。这一步把连接限于知道密钥的人；不要将插件公开分享。
4. 用主账号的网易云 App 开「一起听」，邀请备用号进房。先用连接状态工具确认账号、房间、实时连接和歌曲，再发一条测试消息，确认回复确实出现在房间里。
5. 监听时只选 **Long-wait** 或 **Widget** 一种。Long-wait 单次最长 45 秒，事件到达后先 ACK，再回复；它不会在对话结束后无限后台运行。

Render Free 在连续 15 分钟没有入站流量时会休眠。网易云侧的主动消息不会唤醒已经休眠的 Web Service，需从 ChatGPT 或浏览器发起 HTTP 请求唤醒；唤醒后重新扫码。

## 安全边界

`/mcp/music`、`/mcp` 和 `POST /events` 要求有效访问令牌。扫码接口需要同站点、HttpOnly 的管理会话。公开的 `/` 仅用于健康检查。凭证不写入 HTML、MCP 工具输出、Git 或日志。

本分支面向一人一服务。若需要多个用户各自保存备用号凭证，必须另做账户数据库和按用户分离的 Worker，不可共享同一个进程变量。
