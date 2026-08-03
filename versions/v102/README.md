# v102 — 识别区长文「假截断」：去掉 line-clamp

## 改动文件
- `src/App.css`
- `src/App.tsx`

## 说明
- 识别区 `p` 曾被 `-webkit-line-clamp: 3~5` 裁成几行，长句朗读看起来像只识别一半。
- 改为可滚动展示全文；`?vad-qa=1` 增加 `字×N` 便于核对完整字数。
