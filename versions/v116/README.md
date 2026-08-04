# v116 — 微信内置浏览器提示层

## 改动文件
- `app/src/App.tsx`
- `app/src/App.css`

## 说明
- 检测 UA 含 `MicroMessenger` 时顶部展示可关闭 Alert，提示在系统浏览器打开。
- 登录页、主界面、鉴权中状态均可见；非微信 UA 无变化。
- 浅色极简样式，固定顶栏不遮挡登录操作。
