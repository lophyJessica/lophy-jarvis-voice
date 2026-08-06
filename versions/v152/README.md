# v152 — 自动 TTS 彻底隔离用户输入

## 改动

- `app/src/App.tsx`：将 `streamingText` 改为 `assistantStreamingText`，流式 delta 只用于助手回复上屏；自动 TTS 不再在 delta 到达时入队。
- `app/src/App.tsx`：回复完成并创建 `role: assistant` 消息后，才从该消息生成 TTS 文本；过滤当前用户指令完全回声及前缀回声。
- `app/src/App.tsx`：移除消息变化时自动调用 `/tts` 的后台预热；手动朗读按钮仍只读取最新 assistant 消息。
- `app/src/api/hermes.ts`：保留 v151 的助手角色响应解析约束。
- `app/src/hooks/useSpeechSynthesis.ts`：保留原有 `/tts` 队列、vivi 音色与手动朗读逻辑。
- `app/src/version.ts`：版本更新为 `v152`。

## 验证

- `npm run build` 已通过，生产 bundle 已包含 `createStoredMessage('assistant', responseText)` 后再启动 TTS 的新顺序。
- 本地页面显示 `v152`，测试词 `TTS_INPUT_SHOULD_NOT_BE_SPOKEN_152` 已提交；截图为 `v152-page.png` 与 `v152-input-test.png`。
- VPS nginx 日志已确认 v151 线上确实把 `cd /Users/.../forge-wms`、`1.`、`2.`、`3.` 等输入内容发送到 `/tts`。
- Chrome 线上页面可见但自动化控制被浏览器安全策略阻止，无法代替用户提交新的 v152 测试词；需用户在已登录页面输入 `TTS_INPUT_SHOULD_NOT_BE_SPOKEN_152` 后，从 nginx 日志确认新请求仅含 assistant 回复。
