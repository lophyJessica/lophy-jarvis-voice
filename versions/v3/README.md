# Jarvis Voice v3

## 修改摘要

- 修复页面根节点与主容器锁定 `overflow: hidden` 的问题，允许页面在内容超出时滚动。
- 给聊天历史区建立稳定的独立高度和纵向滚动条，桌面与窄屏分别设置合理最大高度。
- 新消息仅在用户接近列表底部时自动置底；用户手动上滚后保持当前位置。
- 在 `thinking` 和 `speaking` 状态显示明显的“停止”按钮，点击后中断对话请求、停止 TTS 并回到监听状态。
- 未修改 VAD、登录流程或 API 实现。

## 本轮文件

- `src/App.tsx`
- `src/App.css`
- `src/index.css`

完整源码快照保存在本目录 `src/` 下。

## Chrome 自查

- 通过：聊天列表 `clientHeight 505px`、`scrollHeight 754px`，`overflow-y: auto`，滚动条可见。
- 通过：列表手动滚到顶部后发送消息，新增内容期间 `scrollTop` 保持为 `0`。
- 通过：接近底部发送消息后，距离底部为 `1px`，自动置底正常。
- 通过：思考中显示“停止”，点击后状态由“思考中”回到“监听中”。
- 通过：播报中显示“停止”，点击后状态回到“监听中”。
- 通过：页面根元素允许纵向滚动；窄屏样式将主布局改为自动高度并取消卡片最大高度。
- 通过：最终 Console 无 error / warn。
- 说明：5188 当前由独立文字版 `/Users/liulongfei/个人文件/lophy-jarvis` 占用，本轮未停止该进程；语音版在隔离的 5191 Mock 环境完成实际 UI 自查。
- 说明：线上 `https://pmlophy.com/jarvis-voice/` 当前返回 NICOLE ROBIN 文字版页面。本轮未部署、未修改服务器路由。

## 截图

- `v3-chat-scroll.png`：聊天区滚动条和新消息置底。
- `v3-thinking-stop-visible.png`：思考中停止按钮。
- `v3-speaking-stop.png`：播报中停止按钮。
- `v3-thinking-stop.png`：中间态截图，截取时已由思考切换到播报；按不删除历史要求保留。

## 构建与版本控制

- `npm run lint`：通过。
- `npm run build`：通过，只有 Vite 大于 500 kB 的 chunk 提示。
- Git commit：无。
- 未 push、未部署。
