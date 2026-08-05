# v144 版本快照

## 本轮目标

实时语音识别文本到达后，前端立即用浏览器原生 `speechSynthesis` 播放本地中文提示“嗯，让我想一下”，同时保留“正在思考…”状态，掩盖模型思考等待。

## 改动

- `app/src/App.tsx`
  - 监听实时模式 `thinking` 阶段，每轮只播放一次提示音。
  - 设置 `zh-CN`、适度语速/音量，并优先选择中文系统音色。
  - 正式 PCM 回复到达、退出实时模式、清空对话或组件卸载时取消提示音，避免与豆包正式声音叠加。
  - 不调用 Edge/豆包 TTS，提示完全由本地 Web Speech API 合成。
- `app/src/version.ts`：版本更新为 v144。
- `AGENTS.md`：同步当前状态。

## 验证

- `cd app && npm run build` 通过。
- 浏览器实时入口正常，状态条数量为 1，旧语音页数量为 0，控制台无错误。
- 已保存 `v144-realtime-local-prompt.png`；实际提示音需要在支持 Web Speech API 的浏览器/APK WebView 中听取。
