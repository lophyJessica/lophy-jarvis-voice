# Jarvis Voice v4

## 修改摘要

- 所有前端网络请求统一使用 120 秒超时：健康检查、登录、ASR、对话流、TTS、历史 GET/POST/DELETE。
- 每条聊天消息新增 hover 复制按钮，成功后显示“已复制”并在 2 秒后恢复。
- 使用 `marked`（GFM + breaks）和 `dompurify` 安全渲染 Markdown。
- 代码块新增深色主题和独立“复制代码”按钮。
- textArea 旁新增一键复制按钮，空内容时禁用。
- 登录后 GET `/p/jarvis/history`；完整对话结束后显式 POST；清空时 DELETE；GET 失败保留本地缓存。
- 未修改 VAD 核心、登录分支或 ASR 调用流程。

## 本轮文件

- `package.json`
- `package-lock.json`
- `src/App.tsx`
- `src/App.css`
- `src/api/hermes.ts`
- `src/api/request.ts`
- `src/api/history.ts`
- `src/components/LoginPage.tsx`
- `src/hooks/useSpeechSynthesis.ts`
- `src/utils/markdown.ts`

完整快照保存在本目录对应路径下。

## Chrome 自查

- 通过：localhost 开发环境免登录并显示“云端已同步”。
- 通过：输入框复制按钮从可用状态变为“已复制”。
- 通过：用户/助手消息复制按钮可用并显示“已复制”。
- 通过：Markdown 标题、粗体、列表、代码块正确渲染。
- 通过：代码块复制按钮显示“已复制”。
- 通过：完整回合后 POST `/p/jarvis/history`，刷新后 GET 恢复记录。
- 通过：`127.0.0.1` 与 `localhost` 两个独立浏览器存储 origin 均从同一云端测试桩恢复记录。
- 通过：DELETE `/p/jarvis/history` 后界面与云端测试记录清空。
- 通过：31 秒延迟回复约 40.9 秒后完成，未在 30 秒中断。
- 通过：最终 Console 无 error / warn。
- 说明：5188 被独立文字版占用，未停止或修改；语音版浏览器自查使用隔离端口 5191。

## 截图

- `v4-markdown-copy.png`
- `v4-textarea-copy.png`
- `v4-cloud-history.png`

## 构建与版本控制

- `npm run lint`：通过。
- `npm run build`：通过，仅有 Vite 大于 500 kB 的 chunk 提示。
- dist 中包含压缩后的 120 秒常量 `12e4`，不存在 `30000` / `30_000` / `3e4`。
- Git commit：无；未 push、未部署。

## 恢复 v4 快照

将 `versions/v4/` 中的 `package.json`、`package-lock.json` 和 `src/` 对应文件复制回项目根目录。旧版本目录均保留。
