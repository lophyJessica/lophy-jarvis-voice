# v112 — 移除聊天区绿色自定义滚动条

## 改动文件
- `src/App.tsx`
- `src/App.css`

## 说明
- 删除 `message-scrollbar` 主题色滚动块及 `scrollThumb` 同步逻辑，避免与原生滚动条叠成双轨。
- 浅色主题保留单一原生滚动条样式（灰轨 + 灰滑块）。
