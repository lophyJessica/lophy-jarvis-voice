# v79 — webm 增量片走 asr-stream + 预览跟嘴不阻断

改动文件：
- `src/hooks/useVoiceActivityDetector.ts`
- `src/hooks/useStreamingAsr.ts`
- `src/App.tsx`

说明：PCM 不再上传 chunk；MediaRecorder 250ms 增量 webm 合并至 2.5KB/8KB 后上传；恢复开口预览环并加速；预览出字不再阻断后续预览更新；流式 MID 命中后才停预览。
