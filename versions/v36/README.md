# v36 — 流式文本防缩短 + finish 不再卡死

## 改动文件
- `src/hooks/useStreamingAsr.ts`
- `src/hooks/useVoiceActivityDetector.ts`
- `src/App.tsx`
- `src/api/asrStream.ts`（随 v35 保留）

## 说明
- 实测：长句流式文本会被短片段覆盖成「很慢」等末尾碎句；finish 时上传队列积压导致长时间「识别中」。
- chunk 更新改为 prefer 更长文本；end 过短时用更长 interim。
- finish 等待上传队列限时；空 webm 仍回调 finish，避免卡死。
