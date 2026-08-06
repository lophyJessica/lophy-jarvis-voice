# v153 — TTS 跳过代码块

## 改动文件
- `app/src/utils/ttsSentences.ts`（`stripCodeFences` + `cleanSpeechText` / 分句前剥围栏）
- `app/src/App.tsx`（仅代码块无正文时跳过自动播报）
- `app/src/version.ts`（`APP_VERSION = 'v153'`）

## 说明
播报前剥离 ```...``` 围栏内容（含 plaintext/json 等语言标记）；若消息只剩代码块则不调用 /tts。保留 assistant 播报、vivi 音色与 /tts 路径。

## 自检截图
- `v153-tts-strip-codeblock.png`：角标 v153 + 代码块剥离 PASS
