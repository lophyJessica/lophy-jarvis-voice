# v69

## 修改摘要

- 跟嘴加速：PCM 切片 ~30ms、上传缓冲 35ms、prime 120ms / 开录 250ms。
- webm 预览 1s 切片 + 无 interim 时 800ms 周期；chunk 空 text 时紧急触发 /asr 预览。
- 上传在途时继续调度 flush，减少块积压。

## 快照文件

- `public/pcm-capture-worklet.js`
- `src/hooks/useStreamingAsr.ts`
- `src/hooks/useVoiceActivityDetector.ts`
- `src/App.tsx`
