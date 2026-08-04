# v124 — APK 语音识别结果回填界面

## 改动文件

- `app/src/App.tsx`
- `app/src/hooks/useStreamingAsr.ts`
- `app/src/api/hermes.ts`

## 说明

- APK `finishSession` 以 `isCapacitorNative()` 走整段 /asr，去掉 generation 门闩，选最大 webm  blob 识别。
- `processRecording`：`flushSync` 立即写入识别区；`sendMessage` 成功后再清空 transcript。
- `transcribeAudio`：使用 blob 实际 Content-Type，兼容 `data.text` 嵌套字段。
