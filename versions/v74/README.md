# v74

## 修改摘要

- 首字加速：webm 350ms 切片 + 首包 650B 即到即预览（不等定时环）。
- 预览环 850ms，减少无效重复请求（用户侧曾预览×12 首字仍 3.8s）。
- 纠错：的api要代表、零名下、调用语音API、建议你使用使用 等。

## 快照文件

- `src/hooks/useStreamingAsr.ts`
- `src/hooks/useVoiceActivityDetector.ts`
- `src/utils/asrCorrect.ts`
