# v129 — APK TTS 走 getApiBase + 全站 API 审计

## 改动文件

- `app/src/hooks/useSpeechSynthesis.ts`
- `app/src/api/base.ts`
- `app/capacitor.config.ts`

## 说明

- TTS：`${getApiBase()}/tts?text=...`（APK → `https://pmlophy.com/tts`；浏览器 `''` 相对路径不变）
- 同句 TTS 失败重试一次，减轻「只播开头就停」
- `getApiBase()` 加固：`isNativePlatform` + `getPlatform()` 双检
- Capacitor `allowNavigation` 放行 `pmlophy.com`
- 审计：`/asr`、`/p/jarvis/*`（auth/history/asr-stream/file/upload/chat）均已带 `getApiBase()`，无遗漏相对路径
