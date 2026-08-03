# v52 — 修输入框聚焦导致 VAD 完全失效

## 改动文件
- `src/App.tsx`

## 根因
- v51 输入框 `onFocus` 时 `canVadStartSpeech=false`，点过输入框后说话也不识别。

## 修复
- 取消聚焦禁用；改为敲键时 `suppressFor(4s)` 抑制误触。
