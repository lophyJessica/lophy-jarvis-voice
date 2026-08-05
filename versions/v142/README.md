# v142 版本快照

## 本轮目标

- 实时 WebSocket 断开时保持当前聊天主页/实时界面，不切换到旧语音模式。
- 断开后显示“连接断开”，保留退出入口，不启动级联语音降级链路。
- 实时 ASR/文本事件到达时立即显示识别文本并进入“正在思考…”状态，降低 8–10 秒等待感。

## 快照内容

快照保留本轮可运行的实时语音基线文件：`App.tsx`、`ComposerStack.tsx`、`useRealtimeVoice.ts`、`App.css`、采集 Worklet、Vite 代理、版本标识与项目规范。

## 验证

- `cd app && npm run build` 通过。
- 本地关闭 Vite 代理模拟 WS 断开：页面仍为实时聊天状态，显示“连接断开”，旧 `.voice-settings` 页面数量为 0。
- 实时状态映射包含 `thinking: '正在思考…'`，文本事件到达即切换到 thinking。
