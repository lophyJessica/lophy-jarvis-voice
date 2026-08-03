# v93 — chunk 空 MID 时 webm 跟嘴兜底 + 响应解析增强

## 改动文件
- `src/api/asrStream.ts` — 兼容 mid/mid_text/result 等字段
- `src/hooks/useStreamingAsr.ts` — 无 MID 时 webm 预览环；单包上传；chunk× 指标
- `src/App.tsx` — vad-qa 展示 chunk×

## 说明
实测 chunk 可上传但 `text` 常空（end 有字），导致录音中无跟嘴、说完整段出字。
双通路：有 MID 走 stream；无 MID 自动 webm `/asr` 预览跟嘴。
