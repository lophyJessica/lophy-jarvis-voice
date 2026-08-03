# v72

## 修改摘要

- 修 v71「完全不识别」：`/asr` 预览在途时被反复 abort，请求永远完不成。
- 预览在途时跳过新请求；仅停止录音时 abort；webm 快照只更新缓冲由定时环拉预览。

## 快照文件

- `src/hooks/useStreamingAsr.ts`
