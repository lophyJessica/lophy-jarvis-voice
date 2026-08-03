# v39 — 保留最长 interim + 长录音短文本整段 /asr 兜底

## 改动文件
- `src/hooks/useStreamingAsr.ts`

## 说明
- v38 无重复，但长读只发出末句碎片。
- 会话内记录最长 interim；结束时与 end/interim 合并取最佳。
- 同句修订不再用更短片段覆盖长文本。
- webm 较大而结果过短时，再请求整段 `/asr` 补全。
