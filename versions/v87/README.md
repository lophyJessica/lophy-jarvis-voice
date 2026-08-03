# v87 — 收尾三源合并（end + 预览 + 整段 webm）

## 改动文件
- `src/hooks/useStreamingAsr.ts`

## 说明
- 跟嘴路径不变（webm `/asr` 预览，首包 3200B）。
- 收尾时**始终**对整段 webm 调 `/asr`，与百度 `end`、预览最长文本三源 `chooseFinalText` 合并，补句首/句尾截断。
- 移除「仅 end 比预览短 10 字才整段 `/asr`」的条件，避免预览也停在「TLS。」时无法触发补全。
