# v103 — 修 MID 合并卡在 ~41 字：mergeBaiduLiveMid

## 改动文件
- `src/hooks/useStreamingAsr.ts`
- `src/App.tsx`

## 根因
- `applyStreamPiece` 在 similarity≥0.42 时用较短/局部 MID **整段替换**并清空 `committed`，长句朗读约 41 字后不再增长（流式命中仍涨）。

## 修复
- 新增 `mergeBaiduLiveMid`：仅前缀/真扩展才替换，否则逗号拼接；`liveAccum` + `peakRawMid` 跟踪。
- 收尾合并 peak + best + 整段 `/asr` 三源；调试 `liveCharCount`。
