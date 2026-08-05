# v141 — 默认文字主页、单实时链路与可见顶栏按钮

## 改动文件
- `app/src/App.tsx`：默认 `text`；旧语音退出完整 cleanup；实时入口、历史刷新、顶部操作分组与确认交互。
- `app/src/hooks/useRealtimeVoice.ts`：带 token 的端到端实时 WS、16k PCM 上行、24k Float32 播放、打断和模块级单实例仲裁。
- `app/src/components/ComposerStack.tsx`：输入区语音按钮直连实时会话，输入框上方实时状态条与退出/打断。
- `app/src/App.css`：APK 双行顶栏；tag 绿底白字；图标按钮强制 16px、高对比背景与 `opacity: 1`。
- `app/public/pcm-capture-worklet.js`：实时模式可配置 3200B PCM 批次。
- `app/vite.config.ts`：本地 `/p/jarvis` 代理支持 WebSocket。
- `app/src/version.ts`、`AGENTS.md`：版本更新为 v141。

## 验证
- 首次与实时中刷新均回文字主页；旧语音页数量 0。
- 实时运行时状态条数量 1；源码 `new WebSocket` 只在 `useRealtimeVoice.ts`。
- 375px 下 tag 为绿色白字；图标实际 16×16px、`opacity: 1`、按钮 32×32px，无横向溢出。
- 浏览器 Console error 为 0。

## 截图
- `v141-mobile-visible-actions.png`
- `v141-desktop-visible-actions.png`
