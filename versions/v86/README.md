# v86 — 句尾补全 + 首包 3200B

改动文件：
- `src/hooks/useStreamingAsr.ts`

说明：end 为主但预览更长时合并补句尾；end 仍短则整段 webm /asr 兜底；首包 3200B、去掉早探针、空返仅重试 1 次。
