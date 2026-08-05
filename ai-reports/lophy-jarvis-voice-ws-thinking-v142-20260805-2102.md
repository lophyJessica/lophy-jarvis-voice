# AI 自检报告

## 项目任务

项目：lophy-jarvis-voice

版本：v142

任务：修复实时语音 WebSocket 断开时误切换旧语音页；增加识别文本到达后的“正在思考…”反馈并保持单实时链路。

## 改动文件清单

- `AGENTS.md`
- `app/src/App.tsx`
- `app/src/App.css`
- `app/src/components/ComposerStack.tsx`
- `app/src/hooks/useRealtimeVoice.ts`
- `app/src/version.ts`
- `app/public/pcm-capture-worklet.js`
- `app/vite.config.ts`
- `versions/v142/` 本轮版本快照与截图

## 每个改动点说明

1. `useRealtimeVoice.ts` 的 `socket.onclose` 仅清理音频、麦克风和 WS 资源，再设置 `phase=error`/“连接断开”；不修改 App 的 `mode`，也不调用旧级联语音入口。
2. `startRealtime().catch()` 只反馈启动错误，保持当前实时/聊天页面；旧语音页面入口和旧链路代码仍保留，但不会作为实时 WS 断线降级路径。
3. 实时 WS 继续使用模块级 owner/stop 仲裁，源码中 `new WebSocket` 只在 `useRealtimeVoice.ts` 出现，避免重复连接。
4. 收到 ASR/文本事件后立即写入 `transcript`，并将 `connected`/`speaking` 转为 `thinking`，Composer 状态栏显示“正在思考…”，随后收到 PCM 再进入播报态。
5. `APP_VERSION` 更新为 v142，AGENTS 当前状态及版本表同步更新。

## 自检结果

- `cd app && npm run build`：通过。
- 产物：`app/dist/assets/index-Cm6_yP-K.js`、`app/dist/assets/index-Bsw1og4g.css`。
- 浏览器初始加载：版本 v142，旧 `.voice-settings` 页面数量 0，默认显示文字聊天入口。
- 点击实时入口：实时状态栏数量 1，旧语音页数量 0，控制台 error 日志为空。
- 关闭本地 Vite 代理模拟 WS 断开：页面保持实时聊天界面，状态显示“连接断开”，旧 `.voice-settings` 页面数量 0；未回退到旧语音模式。
- 截图：`ai-reports/screenshots/v142-ws-disconnected-stays-text.png`、`ai-reports/screenshots/v142-realtime-thinking-feedback.png`。

## 遗留风险

- 本地断线测试验证了前端状态和资源清理；VPS 豆包代理恢复后的真实音频往返仍需在设备上联调。
- “正在思考…”由服务端 ASR/文本事件触发；若代理完全不发送事件，前端只能显示连接态，不能凭空生成识别文本。
- AudioContext 仍依赖设备浏览器的 16k 采集与 24k 播放支持，失败时会显示启动错误，但不会切入旧语音页。
