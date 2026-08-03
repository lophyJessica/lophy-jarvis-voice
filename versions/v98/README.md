# v98 — 识别区逐字展开动画

## 改动文件
- `src/hooks/useTypewriterFollowAlong.ts`（新）
- `src/App.tsx`
- `src/utils/asrCorrect.ts`

## 说明
- ASR 仍按 webm 块/MID 句级返回；UI 对新增后缀做 ~14–40ms/字 打字机露出
- 句末连续「嗯嗯嗯」发送前剔除
