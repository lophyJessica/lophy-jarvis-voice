# v49 — 修录音中不出字（prime 时序 + UI）

## 改动文件
- `src/hooks/useVoiceActivityDetector.ts`
- `src/App.tsx`

## 根因
- v48 开录 80ms < prime 150ms → 开录后 prime 永不触发，预滚动/会话预热断链。
- `handleVadSpeechStart` 清空 `streamingTranscript`；`transcribing` 阶段 UI 不显示流式文本。

## 修复
- prime 100ms、开录 180ms；开录时兜底补 prime。
- 录音/收尾阶段均展示 `streamingTranscript`；开录不再清空已出字。
