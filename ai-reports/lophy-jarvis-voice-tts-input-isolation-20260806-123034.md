# AI 自检报告

## 项目任务

- 项目：lophy-jarvis-voice
- 版本：v150
- 任务：文字模式 `/tts` 只播报罗宾回复，排除 textArea、input、select、button 等表单控件文本。

## 改动文件清单

- `app/src/hooks/useSpeechSynthesis.ts`
- `app/src/App.tsx`
- `app/src/version.ts`
- `AGENTS.md`
- `versions/v150/README.md`、v150 源码快照与浏览器截图

## 每个改动点说明

- `/tts` 仍由 `useSpeechSynthesis.ts` 使用显式 `text` 参数调用，未增加任何 DOM 文本读取。
- 流式自动播报 API 命名为 `appendAssistantSpeechText`，调用方只传入模型回复 delta，不传入 Composer 输入状态。
- 手动重播和预热从 `messages` 倒序筛选最新 `assistant` 消息，移除 `streamingText` 回退，用户输入框内容没有进入播报来源。
- 保留原有 `/tts` 请求、句子切分、预取、播放时机和音色配置。

## 自检结果

- `cd app && npm run build`：通过。
- 本地浏览器显示 v150，填入 `TTS_INPUT_SHOULD_NOT_BE_SPOKEN_150` 后仅有用户消息时“朗读回复”保持禁用，Console 无 error。
- 本地免登录聊天接口本轮未返回 assistant 内容，因此无法在浏览器中取得真实自动 `/tts` 回合；代码链路和静态检索确认没有 `document.body.innerText`、`querySelector` 等播报取文逻辑。
- 截图：`versions/v150/v150-input-isolation.png`、`versions/v150/v150-text-mode-check.png`。

## 交付产物

- `jarvis-voice.zip`
- zip mtime：`2026-08-06 12:30:00 +0800`
- zip 大小：`341626` bytes
- 主 bundle：`assets/index-47-f3tRM.js`
- 已上传 VPS：`/var/www/pmlophy.com/jarvis-voice-incoming/`

## 遗留风险

- 需要在线上已认证环境完成一次真实 assistant 回复，确认该回复触发 `/tts` 且输入框测试词不出现在请求参数中。
