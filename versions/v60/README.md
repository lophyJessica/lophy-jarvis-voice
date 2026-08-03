# v60

- 对 v59 的附件布局做结构性修复，不再依赖 footer 直属子元素的宽度规则。
- 新增单一 `composer-stack`，将上传状态、文档预览、图片预览和输入框统一包裹。
- stack 内所有区域强制纵向排列、同宽 `792px`，从 DOM 层级杜绝附件与输入框并排。
- 未修改附件处理、上传、消息、语音、登录、历史同步及 API 逻辑。
- 本轮文件：`src/App.tsx`、`src/App.css`、`AGENTS.md`。
- `npm run build` 通过，主包为 `index-n5YZPX7z.js`。
- 本地内置浏览器实际选择图片附件后：预览与输入框均为 `792px`、左边界一致、上下堆叠。
- 线上地址检查仍加载 v58：`index-C85kThzm.js` / `index-SVDN-kDv.css`，未包含 v59/v60 修复。
- 自查截图：`v60-composer-stack.jpg`；无 Console error。
