# v110 — 修 ASR 会话风暴（百度并发被击穿）

## 改动文件
- `src/hooks/useVoiceActivityDetector.ts`
- `src/hooks/useStreamingAsr.ts`
- `src/App.tsx`

## 说明
- VAD：音量在阈值附近抖动时不再立刻撤销预热，需持续安静 600ms 才允许重新 prime。
- `primeSession`：已有未上传音频的会话直接复用，不再每次 prime 都新建。
- `releaseActiveSession`：丢弃会话前先 `asr-stream/end` 通知后端释放，不再等 60s TTL。
- `releaseIdleSession` 接到 VAD `onSpeechPrimeCancel`：预热后没开口就回收会话。
