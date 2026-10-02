---
name: listen-together
description: 在用户明确要开始网易云一起听或查看房间状态时使用私人的 Cove Bridge 工具，收取房间消息、歌词和播放状态，并将回复送回房间。
---

# 分你一只耳机

- 先使用只读连接状态工具确认备用账号和房间状态；不要把 MCP 可连接当作网易云已登录。
- 用户明确开始监听时，在本轮对话选择 Long-wait：调用 `cove_bridge_wait`，单次不超过 45 秒。不要同时打开 Widget Listener。
- 收到事件后，先以事件 ID 调用 `cove_bridge_wait_ack`，再阅读和处理内容。如果事件要求返程回复，调用 `cove_bridge_reply` 把回复送回房间；确认完成后，用户仍要求继续监听才调用下一次 wait。
- 用户要停时，结束 wait 循环。不要声称对话结束后仍在后台值守。用户要求退出一起听时，使用 `netease_together_leave` 并核对确认状态。
- 暂停、继续、下一首、插入下一首和切歌以网易云实际回执为准。失败时说明未确认成功。
- 不请求用户在聊天里发送网易云 Cookie、密码或 Bridge 专属密钥；扫码在服务自己的 `/login` 页面完成。
