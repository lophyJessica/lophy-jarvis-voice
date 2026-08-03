# v51 — 降误触（敲键/环境音）

## 改动文件
- `src/hooks/useVoiceActivityDetector.ts`
- `src/App.tsx`

## 说明
- 默认阈值 0.026→0.036；prime 280ms / 开录 400ms，过滤短脉冲。
- 输入框聚焦时不触发 VAD（打字不误识别）。
- 灵敏度滑块旁补充说明。
