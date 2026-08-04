# v126 — APK 识别区打字机动画

## 改动文件

- `app/src/App.tsx`

## 说明

- APK 专用 `apkAsrFullText` + 第二路 `useTypewriterFollowAlong`（45ms/字），浏览器 PCM 打字机路径不变。
- 识别完成后先逐字展示，再 `sendMessage`；thinking/speaking 期间动画可继续。
- v125 行为保留：识别面板在 thinking/speaking 可见，idle 后清空。
