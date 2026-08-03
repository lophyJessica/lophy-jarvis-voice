# v55 — ChatGPT 浅色极简视觉

## 改动文件

- `src/App.tsx`
- `src/App.css`
- `src/index.css`
- `AGENTS.md`

## 修改摘要

- 改为浅色单列对话布局：极简 header、居中消息流、底部大圆角输入框。
- 用户消息使用蓝底白字，罗宾消息使用浅灰气泡；复制按钮仅 hover 显示。
- 页面不再渲染 JarvisCore Canvas，移除星云、粒子和装饰动画。
- 语音设置整合为简洁面板；新增复用现有图片/文档处理逻辑的附件按钮。
- 登录页同步切换为浅色简洁样式，所有登录、历史、TTS、语音和附件业务回调保持不变。

## Chrome 自查

- 桌面布局、消息气泡、图片/文档历史附件、语音三态、TTS 与历史同步：通过。
- DOM Canvas 数量：0；页面动画：`none`；Console error/warn：0。
- 375px：页面宽度与视口均为 375px，无横向溢出。
- 附件按钮可打开文件选择器；Chrome 扩展未开启文件网址权限，自动注入本地文件被浏览器阻止，附件展示改用历史夹具验证。
- 截图：`v55-chatgpt-desktop.jpg`、`v55-chatgpt-mobile-375.jpg`。

## Git / 部署

- 未 commit、未 push、未部署。
