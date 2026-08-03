# v66

- 定位并修复顶部两个状态标签的颜色：Hermes 在线、历史同步状态统一使用主题绿 `#10A37F` 背景。
- 标签文字和图标统一使用白色，圆角和内边距保持 ChatGPT 风格。
- 未修改图片控件、文件上传、滚动条、登录、语音、TTS 及历史同步逻辑。
- 本轮文件：`src/App.css`、`AGENTS.md`。
- `npm run build` 通过，主包为 `index-CZc-LBG1.js`。
- 本地浏览器实测两个状态标签背景均为 `rgb(16, 163, 127)`，文字与图标均为白色。
- 自查截图：`v66-status-tags.jpg`；无 Console error。
