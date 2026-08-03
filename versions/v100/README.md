# v100 — 回归 v54 百度链路（chunk MID 跟嘴）

## 改动文件
- `src/hooks/useVoiceActivityDetector.ts`
- `src/hooks/useStreamingAsr.ts`
- `src/App.tsx`
- `public/pcm-capture-worklet.js`

## 说明
- VAD 对齐 v54：prime 150ms / 开录 280ms；第一帧有声即建会话。
- 录音中仅 chunk MID 跟嘴（v53/v77）；移除 webm `/asr` 预览环与打字机动画。
- PCM 批次恢复 10240B（~320ms，v78）；上传短合并 50ms。
- webm 仅收尾 / chunk 失败时整段 `/asr` 兜底；保留 v94+ 收尾合并与纠错。
