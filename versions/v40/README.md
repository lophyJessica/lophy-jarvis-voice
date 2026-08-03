# v40 — 下调整段 /asr 兜底阈值

## 改动文件
- `src/hooks/useStreamingAsr.ts`

## 说明
- v39 长读仍只发出约 34 字；原因是整段 `/asr` 触发条件 `size >= 60KB` 过高，语音 webm 很难达到。
- 改为：录音 ≥ 6KB 且文本 < 80 字时走整段 `/asr`，取更长结果。
