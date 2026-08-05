# v133 — 角标安全区 + 语音默认手动

## 改动文件
- `app/src/version.ts`（`APP_VERSION = 'v133'`）
- `app/src/App.css`（角标改左下角 + `safe-area-inset-*`）
- `app/src/App.tsx`（`autoMode` 默认 `false`）
- `app/index.html`（`viewport-fit=cover`，安全区生效）
- `app/src/components/VersionBadge.tsx`（无逻辑变，随包快照）

## 说明
1. 版本角标移到左下角，并预留安全区内边距，避免曲面屏/圆角裁切。
2. 语音模式默认手动：需点中央按钮开始录音；开关仍可切回「自动」VAD。
不改 ASR 引擎 / 浏览器 PCM 路径。
