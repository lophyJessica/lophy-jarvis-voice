# v43 — 修复句级 ASR 丢句 + 本地 /asr 代理

## 改动文件
- `src/hooks/useStreamingAsr.ts`
- `vite.config.ts`

## 说明
- 根因1：百度 MID/FIN 是「一句话」，不是整段累积；前端按整段替换会丢掉已说完的句子。
- 改为 committed（已确认句）+ hypothesis（当前句）模型。
- 根因2：本地 preview 未代理 `/asr`，整段兜底一直 404；现已加入 proxy。
- 较长录音结束时始终尝试整段 `/asr` 与流式结果取更长。
