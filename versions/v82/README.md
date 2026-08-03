# v82 — 收尾句尾补全：等预览落地 + 整段 webm /asr

改动文件：
- `src/hooks/useStreamingAsr.ts`

说明：finish 前先等 in-flight `/asr` 完成；再对完整 webm 识别一次并与 end 合并，减少长句尾被截断（如「建议审慎使用 TLS…」）。
