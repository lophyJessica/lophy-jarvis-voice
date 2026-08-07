# v157 — 菲儿头像本地化

## 改动文件
- `app/public/robin-avatar.png`（菲儿 200×200 PNG，本地随包）
- `app/src/version.ts`（`ROBIN_AVATAR_URL='/robin-avatar.png'`；`APP_VERSION=v157`）

## 说明
顶栏和登录页复用既有 `ROBIN_AVATAR_URL`，现从同源 public 静态资源加载；Capacitor APK WebView 不再依赖远程头像 URL。圆形 36px 与 cover 样式不变。
