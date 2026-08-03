# v80 — 跟嘴回归：webm /asr 预览 + end 收尾

改动文件：
- `src/hooks/useStreamingAsr.ts`
- `src/hooks/useVoiceActivityDetector.ts`

说明：后端 chunk 仅攒 PCM 音频、text 恒空；跟嘴恢复 MediaRecorder 累积 webm + 周期性 `/asr` 预览；说完 `asr-stream/end` 取最终文本并与预览合并；end 失败再整段 `/asr` 兜底。
