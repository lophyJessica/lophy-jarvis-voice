# v54 — 首字加速：有声即建 ASR 会话

## 改动文件
- `src/hooks/useVoiceActivityDetector.ts`

## 说明
- v53 取消监听预热后首字约 1.3s；现检测到声音**第一帧**即 `startSession`，150ms 后再上传预滚动。
- 仍保持 v53：每轮开口新建会话，避免失效预热。
