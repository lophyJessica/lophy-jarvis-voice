# v57

- 将聊天消息滚动容器从居中 `840px` 改为全宽，滚动条移动到页面最右侧。
- 使用响应式水平内边距保持原有消息内容宽度及居中布局。
- 未修改消息、语音、登录、历史同步及 API 逻辑。
- 本轮文件：`src/App.css`、`AGENTS.md`。
- `npm run build` 通过，主包为 `index-CskyxhMs.js`。
- 1920px 视口实测：滚动容器右边界 `1920px`、右侧间隙 `0px`，消息内容宽度保持约 `792px`。
- 自查截图：`v57-scrollbar-right.jpg`；无 Console error。
