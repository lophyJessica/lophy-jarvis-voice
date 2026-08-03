# v27 — TTS 单句失败不再卡死播报状态

- `useSpeechSynthesis`：单句 `/tts` 失败跳过并继续队列（不再 `break` 整段）
- 预取失败回退当场重拉；泵退出时若队列仍有句子则续泵
- 队列耗尽后必 `setIsSpeaking(false)`，避免「没声音但 UI 仍播报中」
