# v62

- 图片预览右上角移除控件改为主题绿色，悬停/聚焦使用浅绿色反馈。
- 新增聊天列表固定可见的自定义滚动指示条，滑块高度与 `scrollHeight/clientHeight` 同步，位置跟随 `scrollTop` 更新。
- 保留原生滚轮、触控和键盘滚动能力，避免 macOS 原生滚动条自动隐藏导致不可见。
- 未修改文件上传、登录、语音、TTS 及历史同步逻辑。
- 本轮文件：`src/App.tsx`、`src/App.css`、`AGENTS.md`。
- `npm run build` 通过，主包为 `index-D_eGyZuh.js`。
- 本地浏览器实测图片控件默认色为 `rgb(16, 163, 127)`；自定义滑块固定可见并随滚动位置更新。
- 自查截图：`v62-theme-scrollbar.jpg`；无 Console error。
