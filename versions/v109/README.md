# v109 — 第二轮开录清空识别区 + 打字机不复用旧字

## 改动文件
- `src/App.tsx`
- `src/hooks/useStreamingAsr.ts`
- `src/hooks/useTypewriterFollowAlong.ts`

## 说明
- 新一句 prime/开录时清空 `streamingTranscript`；发送完成后也清空。
- `startSession` 同步 `onInterimText('')`。
- 打字机在新 target 非前缀扩展时从空字重打，不沿用上一轮展示缓存。
