# v128 — APK 录音中周期 /asr 近似跟嘴

## 改动文件

- `app/src/hooks/useStreamingAsr.ts`
- `app/src/App.tsx`

## 说明

- APK：MediaRecorder 累积 webm，录音中约每 1.2s（首包）/ 1.8s 调用 `POST /asr`，结果实时替换识别区。
- 在途请求未返回前不发下一次；收尾 abort 在途预览后再最终 /asr。
- 停止后保留 v127 打字机（45ms/字）再发送。
- 去掉「结束后识别」文案，改为「正在识别…」。
- 浏览器 PCM 流式路径未改。
