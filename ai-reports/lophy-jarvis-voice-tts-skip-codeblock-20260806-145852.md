# AI 自检报告

- 项目/任务：lophy-jarvis-voice · TTS 播报剥离 markdown 代码围栏（v153）
- 改动文件清单：
  - `app/src/utils/ttsSentences.ts`
  - `app/src/App.tsx`
  - `app/src/version.ts`
  - `versions/v153/`（含 README、改动快照、截图）
  - `AGENTS.md`
- 每个改动点说明：
  1. **ttsSentences.ts**：新增 `stripCodeFences`，去掉 ```/```lang 围栏及未闭合开围栏；`cleanSpeechText` 先剥围栏再清 markdown；`extractCompleteSentences` 整段先剥围栏再分句，避免代码块被 `\n` 拆碎后仍进 `/tts`。
  2. **App.tsx**：自动播报在 `getAssistantSpeechTextForTurn` 结果为空（仅代码块/无正文）时跳过 `beginStreamingSpeech` / `/tts`。
  3. **version.ts**：`APP_VERSION = 'v153'`。
- 自检结果（build/测试是否通过）：
  - `npm run build`：**通过**（`index-DQaC4OZk.js`）
  - 本地模块实测：含 plaintext 代码块的样例 → 仅保留正文；纯代码块 → `""`（跳过）
  - 浏览器预览：角标 **v153**；自检 overlay **PASS**（截图 `versions/v153/v153-tts-strip-codeblock.png`）
  - `jarvis-voice.zip` 已更新
- 遗留风险/待确认：
  - 缩进代码块（非围栏）未剥离；单行反引号 `` `code` `` 仍会去掉反引号但保留内容（与既有 clean 行为一致）
  - 未在真机听感复测 vivi 音色，逻辑未改 `/tts` 路径
