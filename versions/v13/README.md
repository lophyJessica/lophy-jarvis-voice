# v13 — 融合改造（语音 + 文字双模式）

基线 = v12（融合前快照）。本轮把文字版能力融入语音版基座，形成"罗宾"单一入口、双模式。

## 决策落地
1. 品牌统一"罗宾（Robin）"，清除用户可见的 JARVIS/贾维斯字样（保留 `jarvis-token` 等存储键、`/p/jarvis` 后端路径、`model: 'jarvis'` 后端契约、内部类型名 `JarvisCore/JarvisStatus`）。
2. history 存 `content[]` 完整（含 base64 图），不做摘要。
3. 引入 `dexie`，IndexedDB（库名 `robin-console`）仅用于 history 兜底：云端 GET 失败时从 Dexie 恢复本地记录。
4. ChatGPT 式三态按钮（输入框右侧）：有文字→发送箭头；无文字→语音图标（进语音模式）；语音模式→叉号（退出）。语音模式保留输入框可打字。

## 步骤对应
- Step 0 基线：`npm run build` 通过，快照 v12。
- Step 1 数据/API：`types/messages.ts`（MessageContent）、`db.ts`（Dexie）、`api/hermes.ts`（content[]）、`api/history.ts`（SyncMessage，保留图片）。
- Step 2 文字模式 UI：`utils/images.ts`（canvas 压缩 800px/JPEG0.6）、粘贴/上传、composer 图片预览；CSS。
- Step 3 消息列表统一：`components/ChatMessageRow.tsx`（长文展开/收起、图片网格），TTS 仅读 `getMessageText` 文本。
- Step 4 模式切换：三态按钮 + `localStorage('robin-mode')` 记忆；切换时安全停止录音/TTS/进行中请求。
- Step 5 壳与品牌：LoginPage/标题/系统提示词/文案统一为罗宾。
- Step 6 手机端：≤767px 单列、输入区贴底、`env(safe-area-inset-bottom)`、语音大按钮。
- Step 7 Dexie 兜底：挂载时 cloud GET → 成功则 merge 覆盖并写回 Dexie；失败则读 Dexie（UI 显示"本地兜底"）。
- Step 8 验收：build 通过 + 浏览器自查（见对话汇报截图）。

## 改动文件
App.tsx / App.css / index.html / package.json / package-lock.json /
src/api/hermes.ts / src/api/history.ts / src/db.ts（新）/ src/types/messages.ts（新）/
src/utils/images.ts（新）/ src/components/ChatMessageRow.tsx（新）/ LoginPage.tsx / JarvisCore.tsx

## 保持不动
百度流式协议（start/chunk/end, audio/pcm）、AudioWorklet 采集、Edge TTS、登录+用户隔离、MediaRecorder 整段 /asr 降级路径（`api/hermes.ts::transcribeAudio` 保留）。

## 自查限制（本地 dev）
- 无 VPS 代理：`/p/jarvis/*` 与 `/asr` 在 dev 返回 404，对话显示"Hermes 请求失败（404）"、history 走 Dexie 兜底——均为离线预期，非代码缺陷。
- Dexie 完整回环（GET 失败→兜底→GET 成功→云端覆盖）需部署到 VPS 才能验证"GET 成功→云端覆盖"分支；兜底恢复分支已验证（UI 显示"本地兜底"）。
