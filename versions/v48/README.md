# v48 — 日常 VAD 灵敏度回调

## 改动文件
- `src/hooks/useVoiceActivityDetector.ts`
- `src/App.tsx`

## 说明
- 默认阈值 0.018→0.026，减少环境杂音误开录。
- 预热 ASR / 预滚动上传前需持续有声 ~150ms，过滤短促杂音。
- 开录确认窗恢复 80ms；v47 首字优化路径保留。
