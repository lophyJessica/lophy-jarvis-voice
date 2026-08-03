# v46 — 实时出字加速 + 高置信 ASR 纠错

## 改动文件
- `src/hooks/useStreamingAsr.ts`
- `src/utils/asrCorrect.ts`（新增）
- `public/pcm-capture-worklet.js`

## 说明
- PCM 切片约 80ms、首包 40ms 上传；上传在途合并积压，减轻串行 RTT 拖慢实时文本。
- webm 降级切片 2s→400ms。
- 客户端纠正常见误听（GitHub / API密钥 / 账号下 等）；引擎级准确度仍依赖百度侧热词。
