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
| UI | 深空星云 Canvas 背景 + 暗色主题 |

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

### 2.1 交付打包（用户已要求时强制）
- 功能改完且 `npm run build` 通过后，自动在项目根目录生成 **`jarvis-voice.zip`**
- 命令：`rm -f jarvis-voice.zip && cd dist && zip -rq ../jarvis-voice.zip .`（先 build，再对 `dist/` 根目录压缩，解压即部署根）
- 汇报时注明 zip 已更新（大小 / 主 bundle 文件名即可）

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

## 当前状态（2026-08-03，v20）

| 版本 | 摘要 |
|------|------|
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
- ✅ 品牌「罗宾（Robin）」+ 文字多模态 + ChatGPT 式模式按钮 + 手机单列
- ✅ 文档粘贴：PDF/DOCX/XLSX → VPS 解析后作为用户消息分析（与图片粘贴并列）
- ⬜ 图片识别端到端验证（需 VPS vision 联调）

**交付物**：根目录 `jarvis-voice.zip` 对应当前 `dist`（改完 build 后按 §2.1 自动更新）。

