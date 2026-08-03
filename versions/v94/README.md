# v94 — 修流式 MID 回退 + end 截断导致只发「对。您」

## 改动文件
- `src/hooks/useStreamingAsr.ts`

## 说明
- MID 按百度整段累积处理：回退碎片不缩短 UI；`bestInterim` 始终保留最长
- 收尾 `chooseFinalText(end, interim, best)` 三源合并；流式仍短则整段 webm `/asr` 补全
