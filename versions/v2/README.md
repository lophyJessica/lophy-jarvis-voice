# Jarvis Voice v2

## 修改摘要

- 使用 Web Audio API + AnalyserNode 实现前端 VAD，连续说话 300ms 自动开始录音，静音 1500ms 自动结束。
- 复用同一麦克风流录制 audio/webm，并保持监听以支持 TTS 播报时语音打断。
- TTS 开始后 200ms 抑制 VAD；播报期间使用更高触发阈值，降低扬声器回声误触发。
- 新增自动/手动模式切换、VAD 灵敏度滑块、实时音量波形和状态视觉反馈。
- localhost / 127.0.0.1 跳过登录，线上登录、历史同步和 API 路径不变。
- 本地 `?vad-qa=1` 提供只在开发环境出现的 Mock VAD 控件，用同一状态机完成浏览器自动化验证。

## 本轮文件

- `src/App.tsx`
- `src/App.css`
- `src/hooks/useVoiceActivityDetector.ts`
- `src/hooks/useSpeechSynthesis.ts`

上述文件的完整快照位于本目录的 `src/` 下。

## 浏览器自查

- 通过：本地主界面免登录，自动进入“监听中”。
- 通过：实际页面状态依次进入监听中、录音中、识别中、思考中、播报中。
- 通过：播报时模拟说话立即停止播放并进入录音中。
- 通过：`/p/jarvis/v1/models`、`/asr`、`/p/jarvis/v1/chat/completions`、`/tts` 的本地 Mock 请求均为 200。
- 通过：最终一轮 Console 无 error / warn。
- 说明：指定端口 5188 已由独立文字版占用，为遵守项目隔离，本轮语音版使用 5190，Mock API 自查使用 5191。
- 说明：线上仍为未部署的按钮版基线；本轮未 commit、未 push、未部署。

截图：

- `v2-listening.png`
- `v2-recording.png`
- `v2-thinking.png`
- `v2-interrupted-recording.png`

## 构建

- `npm run lint`：通过。
- `npm run build`：通过，Vite 仅报告大于 500 kB 的 chunk 提示。
- Git commit：无（按要求未提交）。

## 恢复 v2 快照

将 `versions/v2/src/` 中的对应文件复制回项目 `src/`。旧版 v1 按原格式仅保存说明与截图，本轮未覆盖或删除任何 v1 记录。
