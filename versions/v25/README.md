# v25 — 启动 token 校验 + 401 静默回登录

- `src/auth.ts`：新增 `JARVIS_AUTH_VERIFY_URL` + `verifyJarvisToken()`（valid/invalid/network-error）
- `src/App.tsx`：`AppShell` 启动阶段 `POST /auth/verify`；401（改密后旧 token）→ 清 token + 登录页；网络错误宽容放行；新增 auth-checking 过渡
- `src/App.css`：`.auth-checking` 过渡屏
- 401 统一处理沿用 `notifyUnauthorized` → 清 token + 回登录页，不误报"暂不可用"

## 自查（192.168.1.5 非 dev 环境）
1. lophy/123456 登录 → 聊天页
2. 篡改 token（模拟改密失效）→ 刷新 → 跳登录页（token 已清）
3. 错误密码 → "用户名或密码错误"
4. 新密码登录 → 聊天页，Hermes 在线 / 云端已同步 / 无"暂不可用"
