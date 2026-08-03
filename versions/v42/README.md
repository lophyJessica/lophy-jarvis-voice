# v42 — 静音 7s + 默认 VAD 更灵敏

## 改动文件
- `src/hooks/useVoiceActivityDetector.ts`
- `src/App.tsx`

## 说明
- `SPEECH_END_SILENCE_MS`：5s → 7s
- 默认音量阈值：0.03 → 0.018（轻声/换气不易误判静音）
