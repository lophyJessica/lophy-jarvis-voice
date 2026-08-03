# v96 — 修 webm 跟嘴首包后不再更新

## 改动文件
- `src/hooks/useStreamingAsr.ts`

## 根因
- webm `/asr` 首次出字后误设 `streamLiveActive`，后续预览被挡
- `>20 字` 规则阻止长句继续预览
- 分离 `applyLiveText`（仅刷新 UI）与 `markStreamLiveActive`（仅 chunk MID）

## 说明
- webm 链式预览（webm 增长继续 /asr）
- chunk 上传会话未就绪时自动重试
