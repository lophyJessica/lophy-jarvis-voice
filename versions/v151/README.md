# v151 — 自动 TTS 助手来源隔离

## 改动

- `app/src/api/hermes.ts`：普通 JSON 回复只接收 `role: assistant` 的完整内容；SSE 自动链路只在收到 `delta.role: assistant` 后接收后续 `delta.content`，不再回退接收 SSE 的 `message.content`。
- `app/src/App.tsx`：流式自动播报回调明确命名为 `assistantDelta`，仅传给 `appendAssistantSpeechText`。
- `app/src/hooks/useSpeechSynthesis.ts`：保留 v150 的 `appendAssistantSpeechText` 助手专用队列接口。
- `app/src/version.ts`：版本更新为 `v151`。

## 验证

- `npm run build` 通过。
- 本地页面加载显示 `v151`，已填入 `TTS_INPUT_SHOULD_NOT_BE_SPOKEN_151` 并保存截图 `v151-tts-input-test.png`、`v151-tts-request-check.png` 与 `v151-tts-input-visible.png`。
- 本地开发环境没有有效云端登录凭证，历史与对话接口返回 401，无法从浏览器触发真实助手回复和 `/tts` 请求；需在已登录会话的 Network 面板复核 `/tts` 参数不含该测试词。
