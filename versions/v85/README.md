# v85 — 首字防 9s + 收尾以百度 end 为准

改动文件：
- `src/hooks/useStreamingAsr.ts`

说明：首包预览改 ≥2400B、空返最多重试 2 次；收尾先 end 再兜底 /asr，不再用预览 tail 污染；chooseFinalText 有 end 时以 end 为主。
