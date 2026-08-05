# v130 — APK 热更新（WebView 加载远程 URL）

## 改动文件

- `app/capacitor.config.ts`
- `app/src/utils/platform.ts`（注释：原生判定与 URL 无关）
- `app/src/api/base.ts`（注释：热更新同源说明）

## 说明

- `server.url = https://pmlophy.com/jarvis-voice/`，`cleartext: false`（仅 https）
- 部署 VPS 后 APK 刷新即新版，无需重装
- `isCapacitorNative()` / `preferWebmStreamingCapture()` 仍看 Capacitor 注入，APK 语音 webm 整段分支不变
- 浏览器 PCM 流式逻辑未动
