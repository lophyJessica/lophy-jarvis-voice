# v81 — 恢复 ?vad-qa=1 跟嘴指标行显示

改动文件：
- `src/App.tsx`
- `src/hooks/useStreamingAsr.ts`

说明：`vad-qa` 下指标行不再依赖 `streamingDebug` 非空；hook 挂载时推送初始 0 值；开口后实时更新。
