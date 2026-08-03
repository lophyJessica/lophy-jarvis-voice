# v34 — VAD 静音分段阈值 1.5s → 3s

## 改动文件
- `src/hooks/useVoiceActivityDetector.ts`

## 说明
- 新增常量 `SPEECH_END_SILENCE_MS = 3000`：静音超过约 3s 才判定说完并分段发送。
- 避免说话中 1–2s 换气/句间停顿被误切成两段（如「哈喽哈喽」与后续问句）。
- 其它 VAD / ASR / TTS / 打断逻辑不变。
