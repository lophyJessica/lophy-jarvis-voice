# v117 — Capacitor APK：isDev 修正 + 麦克风权限

## 改动文件
- `app/src/App.tsx`
- `app/src/utils/platform.ts`（新增）
- `app/android/app/src/main/AndroidManifest.xml`

## 说明
- `isBrowserDevMode()`：`Capacitor.isNativePlatform()` 时不再把 `https://localhost` 判为开发环境，APK 走正常登录。
- `vadQaDebug` 同步排除 Capacitor 原生壳，避免 APK 误开 QA 模式。
- AndroidManifest 增加 `RECORD_AUDIO`、`MODIFY_AUDIO_SETTINGS`；Capacitor `BridgeWebChromeClient` 在 `getUserMedia` 时请求运行时权限。
- **未引入** `@capacitor-community/speech-recognition`：罗宾使用 Web Audio + PCM 流式 ASR，非原生语音识别；manifest 权限即可支撑 WebView `getUserMedia`。
