# v106 — 修长句重复叠加 + 首字延迟

## 改动文件
- `src/hooks/useStreamingAsr.ts`

## 根因
- webm `/asr` 每次返回「从句首开始的整段」，v105 用追加合并 → 「您的API密钥…」重复多遍。
- chunk 更新时 `stopLivePreviewLoop` 打断补全环；首字被 webm 拖到 ~4s。

## 修复
- `mergeWebmCumulative`：更长且共享前缀 → **整段替换**；`mergeChunkMid` 只接新句尾。
- webm 与 chunk 分路合并；展示前 `collapseRepeatedOpenings` 去重。
- 不再因 chunk 停 webm 环；webm 仅在字×<72 或停滞时触发（间隔 5.5s）。
