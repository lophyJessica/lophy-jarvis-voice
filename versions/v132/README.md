# v132 — 版本角标（热更新自检）

## 改动文件
- `app/src/version.ts`（新增：`APP_VERSION = 'v132'`）
- `app/src/components/VersionBadge.tsx`（新增）
- `app/src/App.tsx`（AppRoot 挂载角标，登录/主界面均可见）
- `app/src/App.css`（右下角 12px / opacity 0.4）

## 说明
右下角固定显示当前前端版本号，用于确认 APK 热更新是否拉到新包：
显示 v132 = 已生效；仍显示旧号 = 缓存/未部署。
后续只改 `APP_VERSION` 一处即可。不改语音/业务逻辑。
