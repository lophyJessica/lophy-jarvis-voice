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
app/
├── src/
│   ├── hooks/
│   │   ├── useVoiceActivityDetector.ts   # VAD 免按钮（音量检测）
│   │   ├── useStreamingAsr.ts            # 流式 ASR（PCM 320ms 批次上传）
│   │   └── useTts.ts                     # Edge TTS 播报
│   ├── utils/
│   │   ├── markdown.ts                   # marked + DOMPurify 渲染
│   │   └── ...
│   ├── App.tsx                           # 主框架
│   └── ...
├── public/
│   └── pcm-capture-worklet.js            # AudioWorklet PCM 采集（128帧/16k重采样）
├── server/                               # Python 后端与测试
├── index.html
├── package.json
└── vite.config.ts
versions/                             # 版本快照（每次修改复制改动文件，n 递增）
```

## 关键约定（AI 必须遵守）

### 1. 版本标识（强制）
- 项目根目录 `versions/` 目录
- 每完成一轮修改，把**本轮改动的文件**复制到 `versions/v{n}/`（n 递增，源码保留 `app/` 相对路径）
- 同轮必须写 `versions/v{n}/README.md`，并**更新本文件 `## 当前状态` 的版本号与摘要表**（见 `.cursor/rules/version-sync.mdc`）
- **全局双保险**：`~/.cursor/rules/lophy-jarvis-voice-*.mdc` + 可选粘贴 `context/CURSOR-USER-RULES.md` 到 Cursor User Rules
- 旧版本文件**不删除**，保留完整历史
- 汇报时给出当前版本号 v{n} + 改动文件清单
- 回滚 = 把 `versions/v{n-1}/` 文件复制回源码位置

### 2. 浏览器自查（强制）
- 每次改完必须 `cd app && npm run build` + 内置浏览器打开 `http://127.0.0.1:5188/` 自查
- 自查项：功能是否生效、Console 无报错、Network 请求正常、截图留证
- 不许只看代码断言"应该没问题"

### 2.1 交付打包（强制，与对外汇报同轮）

- **对外汇报前（同一轮对话内、写总结之前）**必须依次执行：
  1. `cd app && npm run build`（通过后再打包）
  2. 更新根目录 **`jarvis-voice.zip`**
- 命令（仓库根目录执行）：`rm -f jarvis-voice.zip && cd app/dist && zip -rq ../../jarvis-voice.zip .`（对 `app/dist/` 根目录压缩，解压即部署根）
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

## 当前状态（2026-08-05，v143）

| 版本 | 摘要 |
|------|------|
| v143 | 聊天记录时间按浏览器/WebView 本地时区显示完整日期与分钟，自动将 UTC ISO 时间转换为本地时间 |
| v142 | 实时 WS 断开保持当前文字主页并显示“连接断开”；ASR 文本到达立即显示“正在思考…”；不触发旧语音回退 |
| v141 | 恢复 v140 实时语音基线；默认文字主页与单 WS/完整 cleanup；APK 顶栏图标强制 16px 高对比可见 |
| v140 | 刷新/重开强制进入文字主页；退出旧语音彻底停止 VAD/ASR/请求/播报；实时 WS 跨组件单实例仲裁 |
| v133 | 角标改左下角+安全区；语音默认手动（可切自动）；`APP_VERSION=v133` |
| v132 | 右下角版本角标 `APP_VERSION`（确认热更新是否生效）；登录/主界面均显示 |
| v131 | 体验：音量节流减打字卡；TTS 预取加深减句间停；APK /asr 0.9s+字节触发跟嘴 |
| v130 | APK 热更新：`server.url=https://pmlophy.com/jarvis-voice/`，部署即生效 |
| v129 | APK TTS：`getApiBase()/tts` + 失败重试；API base 双检 + allowNavigation |
| v128 | APK 近似跟嘴：录音中周期整段 /asr（1.2–1.8s）+ 收尾打字机 |
| v127 | APK 专用打字机：固定 45ms/字 interval，不再复用流式摊时长 hook |
| v126 | APK 识别区打字机：整段 /asr 后 45ms/字 reveal，发前等待动画 |
| v125 | APK 识别区显示：`liveAsrText` 兜底 + thinking 期保留 streaming 面板 |
| v124 | APK 语音：/asr 结果 flushSync 回填识别区并发送；原生 finishSession 加固 |
| v122 | 发送即清空：`onSend` 同步 boolean + flushSync；对话请求异步后台执行 |
| v124 | APK 语音：/asr 结果 flushSync 回填识别区并发送；原生 finishSession 加固 |
| v122 | 发送即清空：`onSend` 同步 boolean + flushSync；对话请求异步后台执行 |
| v121 | APK 语音：webm 整段 /asr；浏览器 PCM 流式不变；Composer 发送即清空（初版） |
| v120 | APK 输入性能：Composer 状态下沉 + 消息列表 memo + 超 100 条懒渲染 |
| v119 | APK 语音：跳过 AudioWorklet，MediaRecorder webm 走 asr-stream/chunk |
| v118 | Capacitor APK：`getApiBase()` 走 `https://pmlophy.com`；桌面应用名改为 Robin |
| v117 | Capacitor APK：排除原生壳 isDev 误判 + Android 麦克风 manifest 权限 |
| v116 | 微信内置浏览器检测：MicroMessenger UA 顶部可关闭 Alert，提示用系统浏览器打开 |
| v115 | 项目结构整理：所有前后端代码归入 app/，根目录保留文档、规范与历史快照 |
| v114 | 修滑块不可见：composer 让出 14px 滚动条列 + 深灰 thumb |
| v113 | ChatGPT 式滚动条：灰轨常驻 + 15px 圆角滑块，去除暗色透明条冲突 |
| v112 | 移除聊天区绿色自定义滚动条，仅保留原生滚动条 |
| v111 | 跟嘴逐字连续：打字机原地换字 + 录音中停用 webm；后端 start 同步握手 |
| v110 | 修 ASR 会话风暴：prime 防抖 600ms + 会话复用 + 丢弃前 end 释放 |
| v109 | 第二轮开录清空识别区；打字机不复用上一轮缓存 |
| v108 | 修误听首 MID 锁死展示；停滞/字少时 webm 补跟嘴；prime 时序修正 |
| v107 | 展示前缀过滤防碎片叠加；去定时 webm 环；识别区逐字跟嘴动画恢复 |
| v106 | 修 webm 整段追加重复；mergeWebm 替换 + 开头去重；chunk 不停补全环 |
| v105 | 长句累积 webm 定时 /asr 补全 + 追加式 MID 合并 |
| v104 | 修 chunk `text[]` 只取一项 |
| v103 | mergeBaiduLiveMid 修 similarity 误替 |
| v102 | 识别区去掉 line-clamp |
| v101 | 多句 MID 拼接 + 整段 `/asr` 三源合并 |
| v100 | 回归 v54 chunk MID 跟嘴 + VAD 150/280ms + PCM 10240B |
| v99 | 放慢逐字动画（38–52ms/字）；纠错 cap→云API |
| v98 | 识别区逐字展开动画 |
| v97 | 纠错：腾讯营app→腾讯云API |
| v96 | 修 webm 首包后跟嘴停更；链式预览 |
| v95 | 修 MID 有命中但识别区不刷新 |
| v94 | 修 MID 回退缩短 + end 截断只发短句 |
| v93 | chunk 无 MID 时 webm 预览跟嘴兜底；增强 chunk 字段解析 |
| v92 | 修开录清空 MID；PCM 2560B/80ms；end 短于流式时合并补尾 |
| v91 | 百度真流式：chunk MID 跟嘴 + end 定稿；webm `/asr` 仅兜底 |
| v90 | 纠错：apm要→API密钥代表、mapr→云API |
| v89 | 纠错：哈弗→GitHub、papi→云API、审慎使用tls→始终使用TLS |
| v88 | 纠错：Apm 1→API密钥、tos→TLS、建议什么使用tos→建议始终使用TLS |
| v87 | 收尾三源合并：end + 预览 + 整段 webm `/asr`，补句首/句尾 |
| v86 | end 为主 + 预览/整段 webm 补句尾；首包 3200B、减空返轮次 |
| v85 | 首包 2400B、收尾先 end、以 end 为准 |
| v84 | 首包 ≥900B、空返重试、250ms 切片（v83 回退） |
| v83 | 跟嘴加速尝试（240B 首包导致首字变慢，v84 回退） |
| v82 | 收尾补句尾：等预览落地 + 整段 webm `/asr` 与 end 合并 |
| v81 | 恢复 `?vad-qa=1` 跟嘴指标行（默认可见、初始 0） |
| v80 | 跟嘴回归：chunk 只攒音频 + webm `/asr` 预览边说边出字 + end 最终文本 |
| v79 | webm 增量片合并上传 asr-stream + 预览环恢复加速 + 预览不阻断连续跟嘴 |
| v78 | 修流式命中×0：PCM 10_240 批次 + 累积 webm 走 asr-stream/chunk + 空 chunk /asr 兜底 |
| v77 | 切回百度 MID 跟嘴：chunk 数组逐片合并 + 停用 webm 预览竞争 + 流式收尾优先 end |
| v76 | 最后一轮压首字（250ms webm/400B 首包/双探针）+ 长文收尾加固 |
| v75 | 首包 520B + webm 300ms；重要信息/云api 纠错 |
| v74 | 首字加速：350ms webm + 首包即到预览 |
| v73 | 修 `?vad-qa=1` 误用 MOCK 不调麦克风 |
| v72 | 修 v71 预览 abort 导致 /asr 永不返回、全程不识别 |
| v71 | 双通路 ASR：webm 预览跟嘴 + 腾讯 end/整段收尾；vad-qa 跟嘴指标 |
| v70 | 首字再压（webm 750ms + 首包预览）+ 腾讯云 API 段常见误听纠错 |
| v69 | 跟嘴加速：PCM 30ms 切片 + webm 1s 预览 + chunk 空 text 紧急 /asr |
| v68 | 语音 live 区去掉「回复文本」，「识别文本」独占整行加宽 |
| v67 | 修录音中不出字：chunk/end JSON 兼容腾讯形态 + webm 定期 /asr 预览补跟嘴 |
| v66 | 顶部 Hermes/历史状态标签统一为主题绿底、白色文字和白色图标 |
| v65 | 图片关闭控件主题绿背景和白色图标增加 `!important`，避免被 Ant Design 默认样式覆盖 |
| v64 | 图片右上角关闭控件改为主题绿背景、白色图标，悬停使用深绿色 |
| v63 | 浅色主题页面背景统一调整为 `#FDFCFC`，保留输入框和卡片白色层次 |
| v62 | 图片移除控件改为主题绿；新增固定可见、随聊天滚动同步的主题色滚动指示条 |
| v61 | 放开所有文件上传类型，非图片统一走后端上传；浅色聊天滚动条改为强制显示高对比度样式 |
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
- ✅ 百度 chunk MID 真流式跟嘴（~300ms 级）；webm `/asr` 仅流式失败兜底
- ✅ 收尾以 `asr-stream/end` FIN_TEXT 为准发送
- ✅ 品牌「罗宾（Robin）」+ 文字多模态 + ChatGPT 式模式按钮 + 手机单列
- ✅ 文档粘贴：PDF/DOCX/XLSX → `file/upload` 存 VPS，罗宾按 path 读文件 + 用户指令
- ✅ ChatGPT 风格浅色极简单列 UI；桌面/375px 自适应；页面无 Canvas 粒子与装饰动画
- ⬜ 图片识别端到端验证（需 VPS vision 联调）

**交付物**：根目录 `jarvis-voice.zip` 对应当前 `app/dist`；**每次对外汇报前**同轮 `cd app && npm run build` + 更新 zip，并在汇报中写明 **zip mtime**（见 §2.1）。
