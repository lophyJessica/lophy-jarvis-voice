# Cursor 全局 User Rules（复制用）

若 `~/.cursor/rules/` 未生效，请打开 **Cursor Settings → Rules → User Rules**，将下面整段粘贴保存（与仓库内 `.cursor/rules/*.mdc` 内容一致）。

---

## lophy-jarvis-voice 专用

当工作区为 **lophy-jarvis-voice**（罗宾语音版）时：

1. 任何代码改动前先读 `AGENTS.md`；遵守 `.cursor/rules/version-sync.mdc` 与 `task-closeout.mdc`。
2. 每轮改完源码：递增 `versions/v{n}/`、写 `README.md`、**同步更新 AGENTS.md「当前状态」**。
3. 每轮结束回复必须包含：**当前版本号 v{n}**、**改动文件清单**、**npm run build 结果**、**jarvis-voice.zip 是否已更新**（用户要交付时必打包）。
4. 用户说「打包 / 部署包」或历史对话已约定自动打包时：`npm run build` 后更新根目录 `jarvis-voice.zip`。
5. 不 commit/push/部署，除非用户明确要求。

其他仓库不适用以上条款。

---

本机已尝试写入（Cursor 新版本会加载）：

- `~/.cursor/rules/lophy-jarvis-voice-version-sync.mdc`
- `~/.cursor/rules/lophy-jarvis-voice-task-closeout.mdc`

可在 **Settings → Rules → Project Rules** 中确认本项目还有：

- `version-sync.mdc`（Always Apply）
- `task-closeout.mdc`（Always Apply）
