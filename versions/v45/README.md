# v45 — 补句首：PCM 预滚动 + 提前建 ASR 会话

## 改动文件
- `public/pcm-capture-worklet.js`
- `src/hooks/useVoiceActivityDetector.ts`
- `src/App.tsx`

## 说明
- 开头「您的 API 密钥」易丢：开录前 300ms 未采集，且 ASR start 有网络延迟。
- Worklet 监听期预滚动约 700ms PCM，开录时先回放缓冲再实时上传。
- 检测到声音立即 `onSpeechPrime` 创建 ASR 会话；开录确认窗 300→80ms。
- 误触发（未开录就静音）会 `cleanupSession`。
