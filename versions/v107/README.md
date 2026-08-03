# v107 — 展示前缀过滤 + 逐字跟嘴 + 去定时 webm 环

## 改动文件
- `src/hooks/useStreamingAsr.ts`
- `src/hooks/useTypewriterFollowAlong.ts`
- `src/App.tsx`

## 说明
- `sessionDisplayRef` + `updateStreamDisplay`：录音中只接受前缀扩展/更长同前缀修订，拒绝 Apiel 等重叠碎片叠加。
- 去掉录音中定时 webm 补全环；流式停滞 ≥8 次时最多补 1 次 webm `/asr`；收尾仍整段 `/asr`。
- 识别区恢复 `useTypewriterFollowAlong`（30–42ms/字），录音/收尾阶段逐字露出。
