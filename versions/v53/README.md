# v53 — 修预热会话失效导致 chunk 空 text 不出字

## 改动文件
- `src/hooks/useStreamingAsr.ts`
- `src/hooks/useVoiceActivityDetector.ts`
- `src/App.tsx`

## 根因
- 监听时 `prepareSession` 建的 ASR 会话在服务端空闲后失效，开口仍复用 → chunk 返回空 `text[]`。

## 修复
- 每次开口 `primeSession` 新建会话；不再监听时提前建会话。
- 阈值 0.032；prime 200ms / 开录 320ms。
