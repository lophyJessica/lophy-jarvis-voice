# v120 — APK 输入框打字性能优化

## 改动文件

- `app/src/App.tsx`
- `app/src/App.css`
- `app/src/components/ComposerStack.tsx`（新增）
- `app/src/components/MessageListView.tsx`（新增）

## 说明

- 输入框 `input` 状态下沉至 `ComposerStack`（memo），击键不再重渲染整个 `VoiceConsole` 与消息列表。
- 消息列表抽至 `MessageListView`（memo），`onCopy` 稳定引用修复 `ChatMessageRow` memo。
- 历史超过 100 条时默认只渲染最近 100 条，可点「显示全部」展开。
- 未改动语音采集（v119）与后端逻辑。
