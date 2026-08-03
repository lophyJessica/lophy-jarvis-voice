# v99 — 放慢识别区逐字动画 + cap 纠错

## 改动文件
- `src/hooks/useTypewriterFollowAlong.ts`
- `src/utils/asrCorrect.ts`

## 说明
- 逐字间隔 38–52ms、单块预算 2.2s，减轻「整句流动」过快
- 纠错：调用cap安全→调用云API有安全风险
