# v121 — APK 语音走整段 /asr + 输入框清空修复

## 改动文件

- `app/src/hooks/useStreamingAsr.ts`
- `app/src/utils/platform.ts`
- `app/src/components/ComposerStack.tsx`

## 说明

- APK（Capacitor）：MediaRecorder webm 仅本地攒片，收尾 `POST getApiBase()/asr` 整段识别；不再发 asr-stream/chunk。
- 浏览器：PCM + AudioWorklet → asr-stream/chunk 流式跟嘴逻辑不变。
- Composer：发送后立即清空 input；校验失败时恢复；`setTextIfIdle` 避免语音识别覆盖正在打字的内容。
