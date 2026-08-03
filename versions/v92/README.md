# v92 — 修 MID 跟嘴首字慢 + 开录清空回归

## 改动文件
- `public/pcm-capture-worklet.js` — PCM 批次 10240→2560（~80ms）
- `src/hooks/useStreamingAsr.ts` — 开录不重置流式指标；end 短于 MID 时合并补尾
- `src/App.tsx` — prime 时清空识别区，开录时保留已出 MID
- `src/utils/asrCorrect.ts` — API密钥o

## 说明
v91 开录会清空 `streamingTranscript` 并重置跟嘴指标，prime 阶段 MID 被抹掉导致首字 ~12s、流式命中仅 2。
