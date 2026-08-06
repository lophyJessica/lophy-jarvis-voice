# AI 自检报告

## 项目任务

`lophy-jarvis-voice` v151：修复文字模式自动播报可能把输入框文本传入 `/tts` 的问题。

## 改动文件清单

- `app/src/api/hermes.ts`
- `app/src/App.tsx`
- `app/src/hooks/useSpeechSynthesis.ts`（保留并随版本快照归档 v150 的助手专用队列接口）
- `app/src/version.ts`
- `AGENTS.md`
- `versions/v151/README.md`

## 改动说明

1. 自动播报路径为 `streamChatCompletion` 的助手增量回调 → `appendAssistantSpeechText` → `/tts`。
2. JSON 完整回复只有 `choices[0].message.role === "assistant"` 时才会进入该回调。
3. SSE 只有在收到 `choices[0].delta.role === "assistant"` 后，才会接收后续 `delta.content`；已删除 SSE `message.content` 回退，防止代理回显请求/输入内容进入自动 TTS。
4. 手动朗读和预热继续只取 `messages` 中最新的 assistant 内容；保留 `/tts` 调用与 vivi 音色配置。
5. 全仓播报调用检索未发现 `document.body.innerText`、`querySelector` 或表单控件文字读取路径。

## 自检结果

- `cd app && npm run build`：通过。
- 本地页面加载显示 `v151`；已输入并发送 `TTS_INPUT_SHOULD_NOT_BE_SPOKEN_151`。
- 页面截图：`versions/v151/v151-tts-input-test.png`、`versions/v151/v151-tts-request-check.png`、`versions/v151/v151-tts-input-visible.png`。
- 生产包：`jarvis-voice.zip`，mtime `2026-08-06 13:10:53 +0800`，大小 `341655` bytes，主 bundle `assets/index-CYdNiUKB.js`。

## 遗留风险

- 本地浏览器没有有效云端登录凭证，`/p/jarvis/history` 返回 401，测试词提交后未获得助手回复，因此未能触发真实 `/tts`。
- 当前内置浏览器控制接口不提供 Network 面板；已完成代码路径和构建验证，但仍需在已登录浏览器中执行一次真实回复，并在 Network 中确认 `/tts` 参数不包含测试词。
