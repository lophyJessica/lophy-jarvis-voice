# v77 — 恢复百度流式 MID 跟嘴

改动文件：
- `src/api/asrStream.ts`
- `src/hooks/useStreamingAsr.ts`
- `src/App.tsx`

说明：chunk 恢复返回 MID 字符串数组（不再 join 成单条）；开口不再启 webm /asr 预览环，流式命中后停用 webm 预览；收尾在流式已出字时以 end+interim 为准，整段 /asr 仅作无流式兜底。
