# v84 — 修 v83 首字回退：首包须 ≥900B + 空返立刻重试

改动文件：
- `src/hooks/useStreamingAsr.ts`
- `src/hooks/useVoiceActivityDetector.ts`

说明：v83 240B 首包常空返浪费 ~2s；首预览改 ≥900B、250ms 切片；空 text 立即用更大 webm 重试；保留链式更新。
