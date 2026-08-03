# v78 — 修 chunk 恒空：PCM 批次 10_240 + webm 累积上传 asr-stream

改动文件：
- `public/pcm-capture-worklet.js`
- `src/api/asrStream.ts`
- `src/hooks/useStreamingAsr.ts`

说明：流式命中×0 因 30ms PCM 块百度不返 MID；对齐 v8/v10 用 ~320ms PCM 与累积 webm chunk；chunk 数组取最长/末项；空 chunk 连续 2 次仍启 /asr 预览兜底。
