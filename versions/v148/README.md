# v148 版本快照

## 本轮目标

实时语音对话收到代理 `robin_text` 事件时，将每句罗宾回复即时显示在聊天记录中，并与最终 history 同步去重。

## 改动

- `app/src/hooks/useRealtimeVoice.ts`
  - 处理 `type=robin_text` 文本事件，按当前实时轮次累积句子并返回 `robinText`。
  - 下一轮 `thinking`、停止、断开或启动新会话时清理实时文本；保留 PCM 播放与提示音逻辑。
  - 忽略停止后到达的旧 WS 消息，避免退出实时模式后残留预览。
- `app/src/App.tsx`
  - 将实时罗宾回复文本传给聊天消息列表；退出实时模式仍触发 history 刷新，最终回复由 history 落库。
- `app/src/components/MessageListView.tsx`
  - 新增普通助手样式的实时预览气泡，按句追加显示并支持复制。
  - 最新 history 助手文本与预览一致时隐藏预览，避免最终同步重复。
- `app/src/version.ts`
  - 版本更新为 v148。
- `AGENTS.md`
  - 同步当前状态与 v148 摘要。

## 验证

- `cd app && npm run build` 通过。
- 浏览器自查：本地 `http://127.0.0.1:5188/` 显示 v148，实时入口连接成功；退出后实时状态与实时回复节点清理，无新增控制台 error。
- 截图：`v148-realtime-mode.png`、`v148-exit-clean.png`。
- 本地代理未产生真实语音回合，`robin_text` 字幕与 PCM 同步仍需 VPS 实际语音会话确认。
