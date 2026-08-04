# v115 — 项目结构整理

- 将前端源码、静态资源、Python 后端及构建配置统一迁入 `app/`。
- 根目录继续保留文档、项目规范、历史快照与交付压缩包。
- 更新 `AGENTS.md`、`README.md` 与 `.cursor/rules/` 中的运行、构建、打包及快照路径。
- `app/vite.config.ts` 显式指定 `app/` 为项目根、`app/dist/` 为构建输出目录。
- 仅调整目录和路径引用，未修改任何业务逻辑。
- `browser-self-check.png`：v115 本地浏览器自查截图。
