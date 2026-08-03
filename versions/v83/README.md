# v83 — 跟嘴加速：100ms 切片 + 预览链式更新

改动文件：
- `src/hooks/useStreamingAsr.ts`
- `src/hooks/useVoiceActivityDetector.ts`

说明：chunk 仍无 MID；压首字（240B 首包/60+150ms 双探针）+ 预览完成后 webm 增长即链式 `/asr` + 更勤更新间隔。
