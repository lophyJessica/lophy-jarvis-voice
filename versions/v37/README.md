# v37 — 流式 ASR 短片段重叠拼接

## 改动文件
- `src/hooks/useStreamingAsr.ts`

## 说明
- 实测长段朗读时 MID 常只回「最近一句」，整段替换会丢掉前文。
- 恢复/加强 `mergeInterimText`：前缀累积优先，否则按尾部重叠拼接。
- end 过短时与 interim 合并后再发送。
