# v6

## 修改摘要

- 将 Markdown 代码块右上角的“复制代码”文字按钮改为纯复制图标，保留可访问名称和复制成功状态。
- 将独立 `textarea` Markdown 内容渲染为深色只读文本面板，仅展示内部文本，支持换行、长文本折行和纵向滚动。
- 文本面板右上角提供纯图标复制按钮，并复用无痕浏览器兼容的剪贴板降级逻辑。

## 本轮快照文件

- `src/App.tsx`
- `src/App.css`
- `src/utils/markdown.ts`

## 浏览器自查

- Chrome 本地调试：通过。
- 独立 textarea 不再显示原始标签或白色可编辑控件：通过。
- textarea 文本面板复制：通过（强制剪贴板 fallback 路径）。
- Markdown 代码块复制按钮仅显示图标：通过。
- Console 无报错：通过。
- 截图：`v6-textarea-icon.png`、`v6-code-icon.png`。

## 构建

- `npm run lint`：通过。
- `npm run build`：通过。
- `git diff --check`：通过。

## Git / 部署

- 未 commit、未 push、未部署。
