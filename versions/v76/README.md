# v76（最后一轮压首字 + 长文）

## 修改摘要

- 首字：webm 250ms 切片、首包 400B、160ms/300ms 双探针预览、开录 200ms。
- 长文：预览环 700ms、收尾上传队列等 4.5s、整段腾讯 /asr 阈值 3KB。
- 纠错：账号名下、腾讯盈资源、权限逗号等。

## 快照文件

- `src/hooks/useStreamingAsr.ts`
- `src/hooks/useVoiceActivityDetector.ts`
- `src/utils/asrCorrect.ts`
