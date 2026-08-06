# v154 — 版本号移至顶栏右侧

## 改动文件
- `app/src/version.ts`（`APP_VERSION = 'v154'`）
- `app/src/components/VersionBadge.tsx`（`placement: header | fixed`）
- `app/src/App.tsx`（顶栏状态标签同排右侧；移除 AppRoot 左下角角标）
- `app/src/components/LoginPage.tsx`（登录页保留 fixed 角标）
- `app/src/App.css`（header 内联 / fixed 角标样式）

## 说明
主界面版本号与 Hermes/同步标签同排靠右；左下角不再显示。登录页仍用角落角标。

## 自检截图
- `v154-header-version.png`：顶栏右侧 v154，左下角无版本号
