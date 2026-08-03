# v24 — file/upload 契约

- `uploadJarvisFile` → `POST /p/jarvis/file/upload`，`X-Jarvis-User`，`{filename, path}`
- `buildDocumentWireText`：请读取文件 {path} 并处理以上指令
- 废弃 `doc/upload` 解析文本流程
