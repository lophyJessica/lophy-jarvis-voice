# v108 — 修误听首包锁死展示 + 停滞时 webm 补跟嘴

## 改动文件
- `src/hooks/useStreamingAsr.ts`
- `src/App.tsx`

## 说明
- `updateStreamDisplay`：误听首 MID（如 apmr）后仍接受百度更长整句修订。
- `streamLiveActive` 不再阻断停滞/字少时的 webm 补全；2.2s 起轻量补跟嘴环。
- prime 先于 beginLivePreview；会话 reset 不再清零跟嘴计时。
