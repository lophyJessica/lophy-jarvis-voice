# v41 — VAD 静音分段 3s → 5s

## 改动文件
- `src/hooks/useVoiceActivityDetector.ts`

## 说明
- 用户确认每次都读完整段后才停，但结果只含前半。
- 实测连录约 30s 即切：段间停顿 ≥3s 时已进入「识别中」，后半段不再录音。
- `SPEECH_END_SILENCE_MS` 调整为 5000。
