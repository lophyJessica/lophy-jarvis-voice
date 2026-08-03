# v58

- 将桌面端输入框最大宽度由 `800px` 收窄为 `792px`。
- 输入框与聊天消息内容列使用相同宽度基准，左右边缘对齐。
- 手机及窄屏仍保持 `100%` 自适应宽度。
- 未修改消息、语音、登录、历史同步及 API 逻辑。
- 本轮文件：`src/App.css`、`AGENTS.md`。
- `npm run build` 通过，主包为 `index-C85kThzm.js`。
- 1920px 视口实测：输入框宽度 `792px`，左边界与消息内容列同为 `564px`。
- 自查截图：`v58-composer-aligned.jpg`；无 Console error。
