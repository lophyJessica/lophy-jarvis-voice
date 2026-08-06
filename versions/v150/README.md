# v150 版本快照

## 本轮目标

限制文字模式 Edge TTS 的文本来源：自动播报只接收罗宾回复 delta，手动重播和预热只读取聊天消息数组中的最新罗宾回复，不读取任何输入或表单控件。

## 改动

- `app/src/hooks/useSpeechSynthesis.ts`
  - 将流式追加 API 命名为 `appendAssistantSpeechText`，仅供助手回复文本进入 /tts 句子队列。
- `app/src/App.tsx`
  - 自动播报仅传入模型流式回复 delta。
  - 手动重播与预热倒序读取 `messages` 的最新 `assistant` 消息；移除对临时 `streamingText` 的回退。
- `app/src/version.ts`
  - 版本更新为 v150。
- `AGENTS.md`
  - 同步当前状态。

## 验证

- `cd app && npm run build` 通过。
- 浏览器打开本地 v150 页面，输入 `TTS_INPUT_SHOULD_NOT_BE_SPOKEN_150` 后仅有用户消息时，“朗读回复”保持禁用，Console 无 error。
- 本地免登录会话的聊天接口未返回 assistant 内容，无法在浏览器中取得真实自动 `/tts` 回合；代码链路确认 /tts 仅由助手 delta 或最新 assistant 消息调用。
- 截图：`v150-input-isolation.png`、`v150-text-mode-check.png`。
