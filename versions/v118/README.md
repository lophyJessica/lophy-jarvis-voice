# v118 — Capacitor APK API 基址 + 应用名 Robin

## 改动文件
- `app/src/api/base.ts`（新增 `getApiBase()`）
- `app/src/auth.ts`
- `app/src/api/hermes.ts`
- `app/src/api/asrStream.ts`
- `app/src/api/history.ts`
- `app/src/api/docUpload.ts`
- `app/src/hooks/useSpeechSynthesis.ts`
- `app/src/components/LoginPage.tsx`
- `app/android/app/src/main/res/values/strings.xml`
- `app/capacitor.config.ts`

## 说明
- Capacitor 原生环境 `getApiBase()` 返回 `https://pmlophy.com`，登录/对话/TTS/ASR 不再打到 `https://localhost`。
- 浏览器仍返回 `''`，本地 dev 与网页版相对路径行为不变。
- APK 桌面与应用标题统一为 **Robin**（`strings.xml` + `capacitor.config.ts`）。
