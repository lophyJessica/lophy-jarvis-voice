# v71

## 修改摘要

- **双通路**：录音中跟嘴 = webm 定时 `/asr` 预览（百度式刷新）；收尾发送 = 腾讯 `asr-stream/end` + 整段 `/asr`（高准确度）。
- 跟嘴：420ms 预览环、500ms webm 切片、prime 不再清空识别区、预览请求可 abort 追新。
- 本地调试：`?vad-qa=1` 显示首字 ms / 预览次数 / 流式命中 / 数据源。

## 快照文件

- `src/hooks/useStreamingAsr.ts`
- `src/hooks/useVoiceActivityDetector.ts`
- `src/App.tsx`
- `src/App.css`
