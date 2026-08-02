# v8

## 修改摘要

- 新增流式 ASR API：`start`、`chunk`、`end`，音频块携带 `X-Session-Id`。
- VAD 开始说话时创建流式会话；MediaRecorder 持续产出 WebM 增量数据。
- 音频块按约 2 秒批次串行上传，每个失败请求静默重试一次。
- 流式链路失败或最终文本为空时，保留并调用原 `/asr` 整段识别降级。
- 30 秒无活动自动结束异常会话；组件卸载时结束尚未完成的会话。
- 录音中新增半透明“识别中”面板，实时展示 MID_TEXT；结束后清除临时文字并使用 FIN_TEXT 发起对话。

## 本轮快照文件

- `src/App.tsx`
- `src/App.css`
- `src/api/asrStream.ts`
- `src/hooks/useStreamingAsr.ts`
- `src/hooks/useVoiceActivityDetector.ts`

## Chrome 自查

- URL：`http://127.0.0.1:5188/?vad-qa=1`
- `POST /p/jarvis/asr-stream/start`：200。
- 多次 `POST /p/jarvis/asr-stream/chunk`：200，服务端收到同一个 `X-Session-Id`。
- 录音期间中间文本从“这是”实时更新到“这是实时识别中间文本”。
- `POST /p/jarvis/asr-stream/end`：200，最终文本为“这是实时识别最终文本”。
- 最终文本进入用户消息，SSE 回复正常，`POST /tts`：200。
- 请求证据：`v8-network.log`。
- 截图：`v8-streaming-asr-mid.jpg`、`v8-streaming-asr-final.jpg`。

## 构建

- `npm run lint`：通过。
- `npm run build`：通过。
- `git diff --check`：通过。

## Git / 部署

- 未 commit、未 push、未部署。
