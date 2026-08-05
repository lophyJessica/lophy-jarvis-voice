# v131 — 打字 / TTS 句间 / 跟嘴体验优化

## 改动文件

- `app/src/hooks/useVoiceActivityDetector.ts`
- `app/src/components/ComposerStack.tsx`
- `app/src/App.tsx`
- `app/src/hooks/useSpeechSynthesis.ts`
- `app/src/utils/ttsSentences.ts`
- `app/src/hooks/useStreamingAsr.ts`

## 说明

1. **打字卡**：VAD 音量 UI 节流 160ms + 阈值 + `startTransition`；Composer 去掉 `status`（只传 `isTranscribing`），减少 memo 失效。
2. **播报停顿**：预取深度 5、冷启动 2、并行 4；播放中 `warmNextPrefetch`；单句上限 42 字。
3. **跟嘴**：APK `/asr` 间隔 0.65s/0.9s，或字节增长 ≥2800 提前触发；仍防堆积。
4. 浏览器 PCM 流式路径未改。
