# v146 版本快照

## 本轮目标

将实时语音 thinking 兜底提示从 `speechSynthesis` 替换为罗宾音色一致的本地 mp3，改善 Capacitor WebView 兼容性。

## 改动

- `app/public/robin-thinking.mp3`
  - 下载自 `https://pmlophy.com/jarvis-voice/robin-thinking.mp3`。
  - MPEG Layer III，24 kHz，单声道，约 3.5 秒。
- `app/src/App.tsx`
  - thinking 状态首次到达时 `new Audio('/robin-thinking.mp3')` 播放。
  - 音频到达、退出实时模式、清空对话或卸载时 `pause()` 并复位到 0 秒。
  - 不再调用 thinking 提示的 `speechSynthesis`。
- `app/src/version.ts`：版本更新为 v146。
- `AGENTS.md`：同步当前状态。

## 验证

- `cd app && npm run build` 通过，mp3 会复制到 `dist/robin-thinking.mp3`。
- 浏览器 v146 实时入口正常、旧语音页数量为 0、控制台无错误。
- 已保存 `v146-local-audio-realtime.png`；真实提示音需在支持音频播放的浏览器/APK 中听取。
