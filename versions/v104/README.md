# v104 — 修 chunk text[] 只取一项丢多句 + 长句停滞 webm 补全

## 改动文件
- `src/api/asrStream.ts`
- `src/hooks/useStreamingAsr.ts`
- `src/utils/asrCorrect.ts`

## 根因
- `pickTextCandidate` 对 `text: ["句1","句2",…]` 只保留最长/末项，其余 FIN/MID 句丢失 → 字×卡 ~44、命中×66。
- 流式停滞时无补全；收尾未强制取各源最长。

## 修复
- `flattenTextPieces` 展平数组，chunk 返回**全部**片段逐片 `mergeBaiduLiveMid`。
- 字× 4 次不增时允许一次 webm `/asr` 长句补全（`longReadBoost`）。
- 收尾 `pickLongestMerged` 合并 end/流式/peak/整段 webm。
