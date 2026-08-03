# v67

## 修改摘要

- 修录音中不出字：`asr-stream/chunk` 支持 `text` 字符串（非仅数组）；`ok` 缺失但有文本时不判失败。
- `asr-stream/end` 兼容仅 `{"text":""}` 响应（腾讯切换后常见）。
- PCM 流式时 MediaRecorder webm 每 ~2s 整段 `/asr` 预览补跟嘴（chunk 无中间 text 时）。
- 收尾识别阶段立即把 end/整段结果推到顶部「识别文本」面板。

## 快照文件

- `src/api/asrStream.ts`
- `src/hooks/useStreamingAsr.ts`
- `src/hooks/useVoiceActivityDetector.ts`
- `src/App.tsx`
