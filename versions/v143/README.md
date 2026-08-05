# v143 版本快照

## 本轮目标

修复聊天记录时间显示为 UTC 的问题。历史 API 返回的 `created_at`/`createdAt` 保持 ISO-8601 原值，消息列表渲染时统一通过 `Intl.DateTimeFormat('zh-CN')` 转换为浏览器或 Capacitor WebView 的本地时区。

## 改动

- `app/src/components/MessageListView.tsx`
  - 消息时间显示为 `YYYY-MM-DD HH:mm`。
  - UTC `Z` 时间先解析为绝对时间，再由运行环境本地时区格式化。
  - 用户消息、罗宾消息和历史加载消息共用同一格式化函数。
- `app/src/version.ts`：版本更新为 v143。
- `AGENTS.md`：同步当前状态。

## 验证

- 使用固定 UTC 样例 `2026-08-05T20:46:28.000Z` 验证本地时区格式化逻辑；中国时区应显示为 `2026-08-06 04:46`。
- `cd app && npm run build` 通过。
- 浏览器页面检查消息列表时间不再显示 `Z`，控制台无错误，并保存截图留证。
