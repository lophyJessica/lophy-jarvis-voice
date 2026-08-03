# v20 — 文档粘贴识别

- `src/api/docUpload.ts`：上传 `/p/jarvis/doc/upload`（字段 `file`）、剪贴板文件分类
- `src/App.tsx`：`handleComposerPaste` 文档/图片分流、解析 loading、`sendMessage` 分析文案
- `src/App.css`：`.composer-doc-upload*`
- `vite.config.ts`：dev/preview 代理 `/p/jarvis`、`/tts` → pmlophy.com（本地自查 Network）
