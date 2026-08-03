# v26 — 思考中顶部播报钮不再变停止

- `src/App.tsx`：`headerSpeechStopping` 仅在真正 TTS 播报时为 true（`speaking` / `isSpeaking`）
- 思考中打断仍用底部停止钮；顶部喇叭保持 SoundOutlined（可禁用）
