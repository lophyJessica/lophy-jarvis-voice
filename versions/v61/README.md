# v61

- 移除文件选择器 `accept` 限制，允许选择任意文件类型。
- 前端过滤改为仅区分图片与非图片：图片保留原预览逻辑，其余文件统一走现有 `/p/jarvis/file/upload`。
- 图片识别增加常见图片扩展名兜底，避免浏览器未提供 MIME 时被误判为文档。
- 浅色聊天列表使用 `overflow-y: scroll`、12px 滚动条及高对比度轨道/滑块。
- 未修改后端、登录、语音、TTS 及附件展示流程。
- 本轮文件：`src/App.tsx`、`src/App.css`、`src/api/docUpload.ts`、`AGENTS.md`。
- `npm run build` 通过，主包为 `index-CixhsfLT.js`。
- 本地浏览器确认文件选择器 `accept` 为空，`.md` 可被选择；图片预览正常；聊天列表为 12px 高对比度滚动条。
- 本地非登录调试身份上传接口返回 401，属于后端认证限制；前端已走统一上传路径。
- 自查截图：`v61-attachments-scrollbar.jpg`；无 Console error。
