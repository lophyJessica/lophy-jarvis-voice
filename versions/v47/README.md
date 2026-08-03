# v47 — 首字延迟再压（预热 ASR + prime 预滚动上传）

## 改动文件
- `src/hooks/useStreamingAsr.ts`
- `src/hooks/useVoiceActivityDetector.ts`
- `src/App.tsx`
- `src/utils/asrCorrect.ts`
- `public/pcm-capture-worklet.js`

## 说明
- 麦克风监听就绪即 `prepareSession` 预热百度会话；开口 `primeSession` 复用，省 start RTT。
- 检测到声音立刻 `flush_preroll` 上传预滚动 PCM（不必等开录）。
- PCM 切片 ~40ms、首包零延迟上传；VAD 开录确认 40ms。
- 取消 prime 不再销毁 ASR 会话；发完一轮自动再预热。
