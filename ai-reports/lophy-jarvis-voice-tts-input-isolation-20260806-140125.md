# AI 自检报告

## 项目任务

`lophy-jarvis-voice` v152：根治文字模式自动 TTS 播报输入框指令的问题。

## 改动文件清单

- `app/src/App.tsx`
- `app/src/api/hermes.ts`（沿用 v151 assistant 角色解析约束）
- `app/src/hooks/useSpeechSynthesis.ts`（沿用助手专用队列接口）
- `app/src/version.ts`
- `AGENTS.md`
- `versions/v152/README.md`

## 根因追踪与修复

1. Composer 输入只存在于 `ComposerStack` 的内部 `input` 状态，通过 `onSend` 作为 `userInstruction` 发送；源码没有 `setStreamingText(input)` 或 DOM 文本读取。
2. v151 的线上日志已证实另一条实际问题：服务端/流式回声内容进入 `appendAssistantSpeechText` 后被句子队列拆分，产生 `plaintext`、`指令重发`、`cd /Users/.../forge-wms`、`1.`、`2.`、`3.` 等 `/tts` 请求。
3. v152 将 `streamingText` 更名为 `assistantStreamingText`，流式 delta 只负责 assistant 回复上屏。
4. 自动播报不再消费 delta；回复完成并创建 `role: assistant` 的 `StoredMessage` 后，才把该消息内容送入 TTS，且过滤当前用户指令的完整/嵌入回声。
5. 删除消息变化时的 `warmUpSpeech` 自动调用，避免旧历史污染在发送新消息时提前触发 `/tts`；手动朗读按钮仍只读取最新 assistant 消息，保留 `/tts` 与 vivi 音色。

## 自检结果

- `cd app && npm run build`：通过。
- 本地内置浏览器加载 v152、Console 无应用错误；历史/对话接口因无凭证返回 401，提交 `TTS_INPUT_SHOULD_NOT_BE_SPOKEN_152` 后没有 assistant 回复，因此本地无法生成真实 `/tts`。
- Chrome 线上页面已确认存在登录会话，但自动化控制被浏览器安全策略拒绝；未伪造 Network 通过结果。
- VPS nginx 读取到 v151 真实错误请求，包含 `cd /Users/liulongfei/个人文件/forge-wms`、`1.`、`2.`、`3.` 等输入内容；v152 代码已切断该流式路径。
- 截图：`versions/v152/v152-page.png`、`versions/v152/v152-input-test.png`。
- zip：`jarvis-voice.zip`；mtime `2026-08-06 14:01:10 +0800`；大小 `341763` bytes；主 bundle `assets/index-DhWjNYUR.js`。
- `rsync` 已成功上传到 `/var/www/pmlophy.com/jarvis-voice-incoming/`；上传后即时公网入口仍显示旧 `index-CYdNiUKB.js`，未手动部署，等待既有 cron 流程处理。

## 遗留风险

- 由于线上 Chrome 自动化被策略阻止，尚未由本工具在登录会话中发送新测试词并读取 v152 的新 nginx 行；需要用户实际发送 `TTS_INPUT_SHOULD_NOT_BE_SPOKEN_152` 后确认新 `/tts` 参数只包含 assistant 回复。
- 未执行 git commit、push、手动部署命令。
