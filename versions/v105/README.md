# v105 — 长句识别：webm 定时补全 + 追加式合并

## 改动文件
- `src/api/asrStream.ts`
- `src/hooks/useStreamingAsr.ts`
- `src/App.tsx`

## 根因
- 百度 chunk MID 长文朗读通常只跟 **第一句**（字×卡 ~44，命中仍涨）。
- 仅靠 chunk 无法覆盖整段；收尾整段 `/asr` 与 end 并行不足。

## 修复
- 开录后每 ~3.5s 对**累积 webm** 打 `/asr`，`mergeBaiduLiveMid` 并入识别区（`源 stream` 不变）。
- 合并改为默认**追加**，去掉 similarity 误替。
- 收尾：整段 `/asr` 与 flush/end **并行**，`pickLongestMerged` 取最长；收尾不清空识别区。
