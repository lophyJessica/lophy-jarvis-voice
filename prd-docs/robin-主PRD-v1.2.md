# 罗宾（Robin）个人 AI Agent — PRD v1.2（当前最终版基线）

> 状态：**当前最终版基线**（非草案）
> 日期：2026-08-04
> 作者：路飞（产品）+ 杰西卡（整理）
> 说明：本文档描述**语音版当前真实现状**。旧融合规划见 §9 历史路线（已归档，无排期）。

## 1. 项目概述

| 项 | 内容 |
|---|---|
| 项目名 | 罗宾（Robin）个人 AI Agent — 语音版 |
| 仓库 | lophy-jarvis-voice |
| 版本 | v1.2（当前最终版基线） |
| 状态 | 收尾定稿，维护模式，无新功能迭代计划 |
| 定位 | 个人 AI 工作站：一个罗宾、双模式（语音实时对话 / 文字思考）、一套记忆 |
| 技术栈 | React 19 + TS + Vite 7 + Ant Design 6 + Dexie + marked + DOMPurify |
| 生产地址 | https://pmlophy.com/jarvis-voice/ |

## 2. 功能清单（全部已完成）

### 2.1 公共能力

| 编号 | 功能 | 说明 | 状态 |
|---|---|---|---|
| F01 | 登录认证 | 5 账号 + 密码 + VPS 后端校验 + token | ✅ |
| F02 | 用户隔离 | 每用户独立 SQLite 历史 | ✅ |
| F03 | 跨浏览器记忆 | /p/jarvis/history，每用户 500 条 | ✅ |
| F04 | markdown 渲染 | marked + DOMPurify + 代码块复制 | ✅ |
| F05 | 消息复制 | 每条消息 hover 复制 | ✅ |
| F06 | 图片识别 | 粘贴 → content[] → Gemini | ✅ |
| F07 | 文本输入框 | textArea 多行 + 文件粘贴 chip | ✅ |
| F08 | 文档识别 | 40+ 类型 → file/upload → 罗宾自读 | ✅ |
| F09 | 手机端适配 | ≤768px 单列全屏 | ✅ |
| F10 | 本地兜底 | Dexie IndexedDB 缓存 | ✅ |

### 2.2 语音模式

| 编号 | 功能 | 说明 | 状态 |
|---|---|---|---|
| V01 | VAD 免按钮 | Web Audio 音量检测自动开始/结束 | ✅ |
| V02 | AudioWorklet PCM | 128 帧/16k 重采样/320ms 批次 | ✅ |
| V03 | 百度流式 ASR | MID 实时出字（~300ms 级） | ✅ |
| V04 | 整段降级 | MediaRecorder webm → /asr（兜底，保留） | ✅ |
| V05 | Edge TTS 播报 | 台湾腔，流式按句播报 | ✅ |
| V06 | 打断 | 播报中说话立即停 | ✅ |
| V07 | 停止思考按钮 | thinking/speaking 可中断 | ✅ |

### 2.3 文字模式

| 编号 | 功能 | 说明 | 状态 |
|---|---|---|---|
| T01 | 打字对话 | textArea 输入 + 发送 | ✅ |
| T02 | 图片粘贴 | Ctrl+V 粘贴截图 | ✅ |
| T03 | 文档粘贴 | 文件 chip + 指令一起发 | ✅ |

### 2.4 模式切换

| 编号 | 功能 | 说明 | 状态 |
|---|---|---|---|
| M01 | 模式切换 | 顶部 🎤语音 / ⌨️文字 | ✅ |
| M02 | 模式持久化 | localStorage 记住上次模式 | ✅ |

## 3. 页面结构

```
LoginPage（登录，5 账号）
└── MainShell（主框架，ChatGPT 风格浅色极简）
    ├── Header：模式切换 + 用户信息 + 退出
    ├── ChatArea：消息列表（markdown + 复制 + 自动滚动）
    ├── VoicePanel（语音模式）：状态光圈 + 实时识别文本（打字机跟嘴）
    ├── TextComposer（文字模式）：textArea + 图片/文档粘贴 + 发送
    └── 状态标签：Hermes/历史连接状态
```

## 4. 用户与角色

| 角色 | 说明 |
|---|---|
| 路飞（Lophy） | 核心用户，产品决策者 |
| 罗宾（Robin） | AI 助理（女性人设，台湾腔） |
| 杰西卡（Jessica） | 飞书端助手（另一入口） |
| 共享账号 | liuyang/sunrong/liangtingfei/zhangwenping |

## 5. 状态机（语音对话）

```
idle(listening) → recording → transcribing(实时出字) → thinking → speaking → idle
            ↑___________________打断___________________|
```

## 6. 数据流

```
输入（语音/文字/图片/文档）→ 识别/组装 → POST /p/jarvis/v1/chat/completions（token）
  → 回复 → markdown 渲染 + 复制 → TTS 播报（语音模式）
  → 每轮结束 → POST /p/jarvis/history（SQLite + Dexie 兜底）
```

## 7. 接口清单（详见 context/05）

| 接口 | 方法 | 用途 |
|---|---|---|
| /p/jarvis/auth/login | POST | 登录 |
| /p/jarvis/auth/verify | GET+POST | token 校验 |
| /p/jarvis/v1/chat/completions | POST | 对话（SSE） |
| /p/jarvis/history | GET/POST/DELETE | 记忆同步 |
| /p/jarvis/asr-stream/start|chunk|end | POST | 流式识别 |
| /p/jarvis/file/upload | POST | 文档保存 |
| /tts | GET | 语音播报 |

## 8. 非目标（Out of Scope）

- ❌ 多会话管理
- ❌ 注册功能（固定 5 账号）
- ❌ PWA / APK
- ❌ 语音识别继续迭代（微信语音输入是用户日常替代）
- ❌ 融合版开发（见 §9 历史路线）

## 9. 历史路线：文字版融合规划（存档，无排期）

> 以下为历史规划，当前**不执行**，仅存档。

- **原目标**：文字版（lophy-jarvis）+ 语音版合并为单一入口，文字版退役
- **原 PRD v1.1 要点**：单入口双模式、模式切换、手机适配（均已在本仓库实现）
- **现状**：融合未启动；两项目独立运行，各自维护
- **未来触发**：用户明确决定启动融合时，以本仓库为基座（已是双模式超集）
- 参考：旧版 `robin-prd-v1.1.md` 内容已并入本文档 §2/§3/§5（功能已实现），不再单独维护

## 10. 验收标准（详见 robin-voice-acceptance-v1.0.md）

- 登录/401/改密链路正常
- 双模式切换 + 持久化正常
- 语音：VAD 触发、流式跟嘴（流式命中>0）、TTS 播报/打断
- 文字：输入/发送/图片/文档
- 记忆：跨浏览器同步 + 刷新不丢
- 部署：https://pmlophy.com/jarvis-voice/ 可访问
