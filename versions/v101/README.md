# v101 — 长句朗读少后半段：多句 MID 拼接 + 整段 webm 补全

## 改动文件
- `src/hooks/useStreamingAsr.ts`
- `src/utils/asrCorrect.ts`

## 说明
- 百度多句 MID 不相似时改为接在后面，避免 `applyStreamPiece` 整段替换丢前文。
- `bestInterim` 按每片 raw MID 累积合并，收尾保留最长流式快照。
- 录音 ≥6KB 时始终整段 `/asr` 与 end/流式三源合并，取更长结果。
- 纠错：`使用腾讯APP`、`通讯与资源` 等常见误听。
