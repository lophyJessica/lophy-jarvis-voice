# v113 — ChatGPT 式滚动条完整显示

## 改动文件
- `src/App.css`

## 说明
- 移除暗色主题遗留的透明细滚动条规则，避免与浅色样式冲突。
- 聊天区 `overflow-y: scroll` + `scrollbar-gutter: stable`，灰轨 `#ececec` 常驻。
- 15px 宽圆角滑块 `#8e8e93`，悬停加深，对标 ChatGPT 灰轨 + 明显滑块。
