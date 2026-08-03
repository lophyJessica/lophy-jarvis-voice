# v91 — 恢复百度 chunk MID 真流式跟嘴

## 改动文件
- `src/hooks/useStreamingAsr.ts`

## 说明
- `asr-stream/chunk` 的 `text`（MID_TEXT）实时合并出字，指标 `流式命中×N`、`源 stream`
- webm `/asr` 预览退为流式失败兜底；收尾以 `end` 的 FIN_TEXT 为准
- 流式未工作时才整段 `/asr` 兜底
