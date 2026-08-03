# v35 — 长句 ASR end 失败仍用流式 interim 发送

## 改动文件
- `src/hooks/useStreamingAsr.ts`
- `src/api/asrStream.ts`

## 说明
- `finishSession`：end 空/失败时优先用已流式 interim，不再丢掉「听过的字」去赌整段 `/asr`。
- 已有 interim 时 end 限时 8s，避免长时间卡在「识别中」。
- `end` 的 `text` 兼容 string / string[]。
