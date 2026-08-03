# v111 — 跟嘴逐字连续：打字机原地换字 + 录音中停用 webm

## 改动文件
- `src/hooks/useTypewriterFollowAlong.ts`
- `src/hooks/useStreamingAsr.ts`
- `server/jarvis-asr-stream.py`（VPS，待部署）

## 说明
- 打字机：MID 修订已出过的字时不清空重打，保持字数原地换字再继续；
  节奏按上次更新间隔自适应（24～150ms/字），填满约 600ms 的 chunk 间隔。
- 录音中不再主动调 webm `/asr`：后端已按会话累积文本，中途插入会把显示顶到
  chunk 前面，导致后续累积文本被判为「更短」而卡死十几秒。webm 仅留作流式失败降级。
- `updateStreamDisplay` 去掉「拒收」分支，同源修订以新的为准。
- 后端：`/start` 同步等百度握手完成再回包；`MID_WAIT` 120ms → 40ms。

## 实测（本地 5188，长文 38.5s）
- 首字 2305ms（上轮 10380ms）
- 录音中 `/asr` 0 次（上轮 3 次）
- 最长卡顿 1247ms（上轮说话中 12637ms）
- 167 次渲染，147 次 +1 字，20 次原地换字，0 次缩回
