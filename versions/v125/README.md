# v125 — APK 识别区显示修复

## 改动文件

- `app/src/App.tsx`

## 说明

- 根因：识别区在 transcribing 只读 `displayedAsrText`（打字机未启动时为空）；thinking 又切到 `transcript` 分支，APK 整段结果无法露出。
- APK：`applyAsrLiveText` 同步写入 `streamingTranscript` + `transcript`；面板用 `displayedAsrText || liveAsrText`。
- thinking/speaking 期间有识别文本时保持 streaming 面板展示；播报结束后才清空（非 TTS 时）。
- 浏览器仍仅 `setStreamingTranscript` 走 PCM 流式跟嘴，逻辑不变。
