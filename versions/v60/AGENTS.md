# AGENTS.md — lophy-jarvis-voice 项目指引

> 本文档是 AI Agent（Codex/Cursor/反重力）在本项目工作时的**第一入口**。
> 任何修改前必须阅读本文档，遵守以下约定。

## 项目定位

罗宾（Robin）——个人 AI Agent 的**语音版**项目。
与文字版（lophy-jarvis）同源，未来将融合为单一入口、双模式（语音实时对话 / 文字思考）。

**铁律：本项目与 lophy-jarvis（文字版）物理隔离，禁止跨项目改代码。**

## 技术栈

| 项 | 内容 |
|---|---|
| 框架 | React 19 + TypeScript + Vite |
| 路由 | React Router（HashRouter） |
| 数据 | Dexie (IndexedDB) |
| 渲染 | marked + DOMPurify（markdown） |
| 语音采集 | AudioWorklet（PCM 直采）+ MediaRecorder（降级） |
| 识别 | 百度流式 ASR（VPS 代理 /p/jarvis/asr-stream） |
| 播报 | Edge TTS（VPS /tts） |
| UI | ChatGPT 风格浅色极简单列布局 |

## 目录结构

```
src/
├── hooks/
│   ├── useVoiceActivityDetector.ts   # VAD 免按钮（音量检测）
│   ├── useStreamingAsr.ts            # 流式 ASR（PCM 320ms 批次上传）
│   └── useTts.ts                     # Edge TTS 播报
├── utils/
│   ├── markdown.ts                   # marked + DOMPurify 渲染
│   └── ...
├── App.tsx                           # 主框架
└── ...
public/
└── pcm-capture-worklet.js            # AudioWorklet PCM 采集（128帧/16k重采样）
versions/                             # 版本快照（每次修改复制改动文件，n 递增）
```

## 关键约定（AI 必须遵守）

### 1. 版本标识（强制）
- 项目根目录 `versions/` 目录
- 每完成一轮修改，把**本轮改动的文件**复制到 `versions/v{n}/`（n 递增）
- 同轮必须写 `versions/v{n}/README.md`，并**更新本文件 `## 当前状态` 的版本号与摘要表**（见 `.cursor/rules/version-sync.mdc`）
- **全局双保险**：`~/.cursor/rules/lophy-jarvis-voice-*.mdc` + 可选粘贴 `context/CURSOR-USER-RULES.md` 到 Cursor User Rules
- 旧版本文件**不删除**，保留完整历史
- 汇报时给出当前版本号 v{n} + 改动文件清单
- 回滚 = 把 `versions/v{n-1}/` 文件复制回源码位置

### 2. 浏览器自查（强制）
- 每次改完必须 `npm run build` + 内置浏览器打开 `http://127.0.0.1:5188/` 自查
- 自查项：功能是否生效、Console 无报错、Network 请求正常、截图留证
- 不许只看代码断言"应该没问题"

### 2.1 交付打包（强制，与对外汇报同轮）

- **对外汇报前（同一轮对话内、写总结之前）**必须依次执行：
  1. `npm run build`（通过后再打包）
  2. 更新根目录 **`jarvis-voice.zip`**
- 命令：`rm -f jarvis-voice.zip && cd dist && zip -rq ../jarvis-voice.zip .`（对 `dist/` 根目录压缩，解压即部署根）
- **汇报中必须写明 zip 的 mtime**（与 build 同轮），例如执行 `ls -la jarvis-voice.zip` 或 `date` 后的时间；可附带大小 / 主 bundle 文件名（如 `index-*.js`）
- **禁止**在较早轮次打过 zip 后，仅改代码或仅文字汇报而不重新 build + zip；用户看到的「完成时间」应与 zip 修改时间一致

### 3. 红线禁止
- 不 commit、不 push、不部署（部署由用户确认后执行）
- 只改本项目，禁止碰 lophy-jarvis（文字版）
- 不删除旧版本记录
- 不擅自改登录、历史同步、VAD 核心逻辑（除非指令明确要求）
- 不引入新依赖（除非必要并说明理由）

### 4. 降级路径保护
- MediaRecorder 整段 /asr 降级路径**必须保留**（AudioWorklet 失败时兜底）
- 删除任何"看似冗余"的降级代码前，先确认没有依赖它

## 后端接口（VPS 已就绪）

| 接口 | 方法 | 用途 | 认证 |
|---|---|---|---|
| /p/jarvis/auth/login | POST | 登录（username+password） | - |
| /p/jarvis/v1/chat/completions | POST | 对话（Hermes → 模型） | Bearer token |
| /p/jarvis/history | GET/POST/DELETE | 跨浏览器记忆同步 | Bearer token |
| /p/jarvis/asr-stream/start | POST | 流式会话创建 | - |
| /p/jarvis/asr-stream/chunk | POST | 音频块（audio/pcm 或 audio/webm） | X-Session-Id |
| /p/jarvis/asr-stream/end | POST | 会话结束拿最终文本 | - |
| /tts | GET | Edge TTS 播报 | - |

## 开发模式

- `isDev` 判断（localhost/127.0.0.1）→ 免登录直接进主界面
- VPS 部署（https://pmlophy.com）→ 正常登录流程

## 当前状态（2026-08-03，v60）

| 版本 | 摘要 |
|------|------|
| v60 | 结构性修复附件布局：附件区与输入框统一置于单一 `composer-stack`，杜绝横向并排 |
| v59 | 修复选择附件后预览与输入框横向并排；改为同宽纵向堆叠并补齐文档 chip 样式 |
| v58 | 底部输入框收窄至 `792px`，与聊天消息内容列左右边缘精确对齐 |
| v57 | 聊天区滚动容器扩展为全宽，滚动条移至视口最右侧，消息内容保持居中 |
| v56 | 用户消息气泡由蓝色恢复为品牌原色 `#10A37F` |
| v55 | ChatGPT 浅色极简单列视觉；移除页面 Canvas、星云与装饰动画，融合功能保持不变 |
| v54 | 首字加速：有声第一帧建 ASR 会话 + 150ms 后预滚动上传 |
| v53 | 修不出字：开口新建 ASR 会话，不复用失效预热会话 |
| v52 | 修输入框聚焦导致 VAD 失效；敲键 4s 抑制 |
| v50 | 去掉输入框上方重复 live-transcript |
| v49 | 修录音中不出字：prime 时序 + transcribing 显示流式文本 |
| v48 | 日常 VAD 回调：默认阈值 0.026 + 预热前 150ms 持续有声确认 |
| v47 | 首字再压：监听预热 ASR + prime 预滚动上传 + PCM 40ms/首包零延迟 |
| v46 | 实时出字加速（PCM 80ms/首包 40ms + 在途合并）+ 高置信误听纠错 |
| v45 | PCM 预滚动 ~700ms + 提前建 ASR 会话，减轻句首丢失 |
| v44 | 修 v43 误拆句导致重复膨胀；膨胀时优先整段 /asr |
| v43 | 句级 ASR 累积（committed+hypothesis）+ 本地代理 `/asr` 兜底 |
| v42 | 静音分段 7s + 默认 VAD 阈值 0.018（更灵敏） |
| v27 | TTS 单句失败跳过继续播；修「没声音但 UI 仍播报中」卡死 |
| v26 | 思考中顶部播报钮不再变停止；打断仅用底部停止钮 |
| v25 | 启动 `POST /auth/verify` 校验 token；改密后刷新→登录页；401 静默回登录不报"暂不可用" |
| v24 | 文档上传改 `POST /p/jarvis/file/upload` + `X-Jarvis-User`；罗宾按 path 读文件 |
| v23 | 用户消息展示：仅 📄 文件名 + 指令 |
| v22 | 文档作上下文：发送时【用户指令】+【文档内容】content[] |
| v21 | 文档待发送 chip + 解析 loading 不拖到对话结束 |
| v20 | 聊天框 Ctrl+V 粘贴 PDF/DOCX/XLSX → doc/upload 解析后以用户消息发送分析 |
| v19 | 版本流程烟雾测试：`persistTurn` 注释标注 Robin，无逻辑变更 |
| v18 | Cursor 全局 User Rules + 项目 task-closeout 收尾规则 |
| v14 | 聊天记录 `createdAt` 保留 + Dexie 实时落库 |
| v15 | `toChatHistory` 同步字段含 `id/createdAt` |
| v16 | 流式按句 Edge TTS 队列 + 播报停止修复 |
| v17 | 复制钮 / textarea / 代码块样式对齐文字版 lophy-jarvis |

**能力清单（至 v17 功能；v18 为流程规则）**

- ✅ VAD 免按钮 + 打断
- ✅ AudioWorklet PCM 直采 + 百度流式实时出字
- ✅ 跨浏览器记忆 + Dexie（robin-console）本地兜底
- ✅ markdown + 代码块「复制」+ 消息圆形复制钮（同文字版）
- ✅ `<textarea>` 标签内容：只读 textarea + 右上角复制（同文字版）
- ✅ Edge TTS：流式按句播报；文字/语音模式默认自动朗读；喇叭可手动朗读/停止
- ✅ VAD 静音分段约 7s + 默认阈值 0.036（办公室/敲键）；滑块可调；输入框聚焦暂停 VAD
- ✅ 百度句级流式累积 + 本地 `/asr` 整段兜底代理
- ✅ 流式出字加速（监听预热 ASR + prime 预滚动上传 + 短 PCM 切片）+ 常见专有词误听纠错
- ✅ 品牌「罗宾（Robin）」+ 文字多模态 + ChatGPT 式模式按钮 + 手机单列
- ✅ 文档粘贴：PDF/DOCX/XLSX → `file/upload` 存 VPS，罗宾按 path 读文件 + 用户指令
- ✅ ChatGPT 风格浅色极简单列 UI；桌面/375px 自适应；页面无 Canvas 粒子与装饰动画
- ⬜ 图片识别端到端验证（需 VPS vision 联调）

**交付物**：根目录 `jarvis-voice.zip` 对应当前 `dist`；**每次对外汇报前**同轮 `npm run build` + 更新 zip，并在汇报中写明 **zip mtime**（见 §2.1）。
