# v9

## 修改摘要

- 新增 AudioWorklet PCM 采集器，每 128 帧读取输入并重采样到 16 kHz。
- Float32 音频转换为 PCM 16-bit little-endian，每 5120 字节向主线程发送一次。
- 发送层合并相邻 PCM 采集批次，使 Network 请求稳定在约 320ms 一次，Content-Type 为 `audio/pcm`。
- AudioWorklet 使用静音输出节点保持运行，不把麦克风声音回放到扬声器。
- MediaRecorder 继续并行保存完整 WebM；AudioWorklet 初始化失败时继续使用原 WebM 流式路径，网络失败时继续使用原 `/asr` 整段降级。

## 本轮快照文件

- `public/pcm-capture-worklet.js`
- `src/hooks/useVoiceActivityDetector.ts`
- `src/hooks/useStreamingAsr.ts`

## Chrome 自查

- AudioWorklet 文件加载：200。
- PCM chunk：Content-Type `audio/pcm`，间隔 313–326ms。
- 录音开始后一秒内出现中间识别文本。
- 停止后最终文本进入用户消息，SSE 对话及 TTS 均正常。
- Network 记录：`v9-network.log`。
- 截图：`v9-pcm-live-under-1s.jpg`、`v9-pcm-final.jpg`。

## 构建

- `npm run lint`：通过。
- `npm run build`：通过。
- `git diff --check`：通过。

## Git / 部署

- 未 commit、未 push、未部署。
