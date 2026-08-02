# v7

## 修改摘要

- 输入区复制按钮直接读取受控 textarea 当前值，并持有 Ant Design TextArea 原生元素引用。
- Clipboard API 与 `execCommand('copy')` 降级在同一次用户点击激活期间启动，避免无痕/受限模式下异步失败后丢失用户激活。
- `execCommand` 降级直接选中当前可见 textarea，并通过 `copy` 事件写入 `text/plain` 数据。
- 输入区按钮增加明确的“复制 / 已复制”文字反馈，成功状态保留 2 秒。

## 本轮快照文件

- `src/App.tsx`
- `src/App.css`
- `src/utils/clipboard.ts`

## Chrome 自查

- 本地地址：`http://127.0.0.1:5188/`
- 输入 `JARVIS textarea clipboard v7 final` 后点击复制：按钮显示“已复制”。
- 清空输入框后按 `⌘V`：粘贴值与原文完全一致。
- 页面状态正常，无应用错误提示。
- 截图：`v7-textarea-copy-success.jpg`。

## Git / 部署

- 未 commit、未 push、未部署。
