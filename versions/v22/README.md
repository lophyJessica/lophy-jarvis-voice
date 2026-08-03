# v22 — 文档上下文 + 用户指令

- `buildComposerMessageContent`：`【用户指令】` + `【文档内容】` 多段 text
- 仅有文档 chip 时发送 → 提示输入指令
- 文档正文出站截断 5000 字；解析 loading 仅覆盖 upload
