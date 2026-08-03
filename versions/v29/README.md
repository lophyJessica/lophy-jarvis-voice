# v29 — 历史字符串格式文档消息展示兼容

- `getUserDocumentMessageDisplay`：兼容旧版拼接字符串 content（`【用户指令】…【文档内容】文件名：…`）
- 数组多段 content 逻辑不变；渲染仍为 📄 文件名 + 指令
