# AI 自检报告

## 项目任务
lophy-jarvis-voice v141：默认进入文字主页、旧语音链路彻底清理、实时 WS 全局单实例、APK/网页顶部按钮清晰可见。

## 改动文件清单
- `app/src/App.tsx`
- `app/src/hooks/useRealtimeVoice.ts`
- `app/src/components/ComposerStack.tsx`
- `app/src/App.css`
- `app/public/pcm-capture-worklet.js`
- `app/vite.config.ts`
- `app/src/version.ts`
- `AGENTS.md`
- `versions/v141/README.md` 及源码快照、浏览器截图

## 每个改动点说明
1. 启动时强制 `mode=text`，不恢复 `voice/realtime`；实时运行中刷新同样回文字主页。
2. 退出旧语音模式 abort Hermes、取消 TTS、停止实时 WS/VAD、清理 Streaming ASR 与识别/流式状态；卸载 cleanup 同步覆盖。
3. 实时模块使用模块级 owner/stop 仲裁，新实例启动前关闭旧实例；`new WebSocket` 仅存在一处。
4. 恢复输入区实时入口、token 查询参数、16k PCM 上行、24k Float32 播放与实时状态条。
5. 顶栏状态与按钮分组；APK 第一行右侧操作、第二行左侧状态。按钮强制 32×32px、图标 16px、深灰/浅灰高对比、`opacity:1`；tag 强制绿色背景白字。

## 自检结果
- `cd app && npm run build`：通过。
- 375×812：两个 tag 均 `rgb(16,163,127)` 背景、白字、opacity 1；播报/清除图标 16×16px，按钮 32×32px，无页面横向溢出。
- 默认页面：旧语音页 0、实时状态条 0、实时入口 1；历史同步完成后文字输入可用。
- 实时页面：状态条 1、旧语音页 0；实时中刷新后状态条 0 并回文字主页。
- 浏览器 Console error：0。
- 截图：`v141-mobile-visible-actions.png`、`v141-desktop-visible-actions.png`。

## 遗留风险
- 本轮开始时本地仓库被外部流程重置到 v133，且 v134–v140 源码快照消失；已通过 VPS v140 dist 备份确认线上基线，并从源码重建相关能力后重新构建验证。
- 本地 dev 不显示生产退出登录按钮；APK 分支会在同一操作组渲染第三个 32px 按钮并应用相同 16px 图标样式。
- 自动化环境无法真实说话，单回复通过单 WS 源码位置、模块级仲裁和单实时状态实例验证。
