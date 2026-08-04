# v119 — APK 语音采集：强制 MediaRecorder + webm 流式上传

## 改动文件
- `app/src/utils/platform.ts`
- `app/src/hooks/useVoiceActivityDetector.ts`
- `app/src/hooks/useStreamingAsr.ts`

## 说明
- 根因：Capacitor WebView 上 AudioWorklet 可能加载成功但不产出 PCM，会话已 start 但 chunk=0 → 百度 -3101。
- `preferWebmStreamingCapture()`：原生壳跳过 AudioWorklet，强制 MediaRecorder。
- `enqueueChunk` 恢复 webm → `asr-stream/chunk` 上传路径（合并切片后上传）。
- MediaRecorder 自动选择 WebView 支持的 mime（webm/ogg/mp4）。
