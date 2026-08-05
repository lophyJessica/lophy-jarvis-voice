# v145 版本快照

## 本轮目标

让实时代理发送的文本事件真正触发 v144 本地思考提示音，并使用完整版提示文案。

## 改动

- `app/src/hooks/useRealtimeVoice.ts`
  - 增加 `type: "thinking"`（以及嵌套 `data.type`）识别。
  - thinking 事件设置 `phase="thinking"`，从 `text`、`transcript`、`recognized_text`、`recognition` 或 `asr_text` 提取识别文本。
  - 二进制 PCM 仍走原有播放器，进入 `speaking`。
- `app/src/App.tsx`
  - 本地 `speechSynthesis` 文案更新为“收到，嗯...等下让我来思考下回复你”。
  - 保持 thinking 只提示一次、speaking/退出时取消提示。
- `app/src/version.ts`：版本更新为 v145。
- `AGENTS.md`：同步当前状态。

## 验证

- `cd app && npm run build` 通过。
- 浏览器 v145 页面实时入口正常、旧语音页数量为 0、控制台无错误。
- 已保存 `v145-thinking-event-chain.png`；自动化浏览器无法注入真实麦克风/代理 thinking 帧，完整听音需在实际浏览器或 APK 中验证。
