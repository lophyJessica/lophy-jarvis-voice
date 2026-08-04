# v127 — APK 专用打字机（固定 45ms/字）

## 改动文件

- `app/src/App.tsx`

## 根因（v126 失效）

`useTypewriterFollowAlong` 按「流式增量摊时长」设计：`charMs = gap*0.95/suffixLen`。
APK 整段一次塞入全文时 `suffixLen` 很大 → `charMs` 被压到 `MIN_CHAR_MS(24)`，
且该 hook 在 `enabled=false` 时直接 `setDisplay(target)` 全量；与浏览器多次增量更新路径不兼容。

## 修复

- APK 不再走 `useTypewriterFollowAlong`；新增 `revealApkAsrText`：`setInterval` 每 45ms +1 字。
- `processRecording`：`await revealApkAsrText(text)` 完成后再 `sendMessage`。
- 浏览器 PCM 打字机路径未改。
