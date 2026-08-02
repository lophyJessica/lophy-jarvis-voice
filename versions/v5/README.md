# Jarvis Voice v5

## 修改摘要

- Clipboard API 成功时继续使用标准复制；无痕或权限受限导致写入失败时，自动切换到隐藏 textArea + `execCommand('copy')` 回退。
- 回退 textArea 位于屏幕外、不可聚焦浏览，不会造成页面闪动或布局偏移；复制后恢复原焦点。
- composer 复制按钮改为紧凑圆形图标，避免挤压输入框；成功状态显示勾选图标。
- Markdown 回复中的 `form`、`textarea`、`input`、`select`、`button` 不再渲染成真实交互控件，统一转换为暗色、可复制的 HTML 代码块。
- 增加仅 localhost 可用的 `clipboard-fallback` QA 开关，用于稳定验证无痕回退路径，线上不会自动触发。

## 本轮文件

- `src/App.tsx`
- `src/App.css`
- `src/utils/markdown.ts`
- `src/utils/clipboard.ts`

完整源码快照保存在本目录 `src/` 下。

## Chrome 自查

- 通过：线上复现到回复中的 `<textarea>` 被渲染为白色表单控件。
- 通过：本地强制 Clipboard API 不可用后，composer 复制仍显示成功勾选。
- 通过：代码块复制在相同回退模式下显示“已复制”。
- 通过：Markdown 中的 `<textarea>` 显示为暗色 HTML 代码块并带复制按钮。
- 通过：修复后页面仅保留 composer 一个真实 textArea。
- 通过：Console 无 error / warn。
- 说明：Chrome 插件无法创建真正的无痕窗口，因此使用与无痕权限失败等价的强制回退开关实际执行复制路径。

## 截图

- `v5-incognito-textarea.png`
- `v5-incognito-copy.png`

## 构建与版本控制

- `npm run lint`：通过。
- `npm run build`：通过，仅有 Vite 大于 500 kB 的 chunk 提示。
- Git commit：无；未 push、未部署。
