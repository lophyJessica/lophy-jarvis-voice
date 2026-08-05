# v147 版本快照

## 本轮目标

压缩实时语音开场等待：用户点击进入实时模式时解锁 AudioContext；`robin-thinking.mp3` 播放期间丢弃所有到达的 PCM 帧，提示音结束后再恢复正式回复音频。

## 改动

- `app/src/hooks/useRealtimeVoice.ts`
  - 接收 `thinkingPromptAudioRef`，在 ArrayBuffer/Blob PCM 入口检查提示音是否 `!paused && !ended`。
  - 提示音播放期间直接跳过帧，不创建 AudioBuffer、不加入播放队列。
  - thinking 事件到达时清理此前可能排队的回复帧；提示音结束后 PCM 自动恢复。
- `app/src/App.tsx`
  - 用户手势进入实时模式时创建并 `resume()` AudioContext，播放一个静音采样并预加载/解码 mp3。
  - thinking 时优先通过 AudioBufferSource 播放 mp3；解码失败时保留原生 Audio fallback，并记录失败日志。
  - 将 `realtimeThinkingAudioRef` 和播放状态 ref 传给实时 WS hook；退出/卸载时停止并关闭上下文。
- `app/src/version.ts`：版本更新为 v147。
- `AGENTS.md`：同步当前状态。
- `app/public/robin-thinking.mp3`：随快照保留运行所需本地资源。

## 验证

- `cd app && npm run build` 通过。
- 浏览器 v147 页面实时入口正常、旧语音页数量为 0、控制台无错误。
- 已保存 `v147-audio-unlock.png`；真实 PCM 丢帧效果需在代理返回 thinking 与 PCM 的实际会话中听取。
