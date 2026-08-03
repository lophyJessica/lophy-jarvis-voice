# v30 — TTS 预取流水线（深度 3）

- `useSpeechSynthesis`：预取深度 3、最多 3 路并行 `/tts`
- 播放当前句时 N+1…N+3 已在拉取；onended 后直接播 ready blob
- 停止时 AbortController 取消全部未完成预取；单句失败仍跳过继续
