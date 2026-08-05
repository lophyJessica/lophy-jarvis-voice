---
name: ai-artifact-pipeline
description: "AI 产物自动流转管道：Cursor/Codex 改完 → 自动上传 zip 到 VPS 自动部署 + 自动提交自检报告 → 杰西卡审核出 digest。解决'用户当 AI 之间搬运工'的痛点（AI 输出太快，人审核累）。"
version: 1.0.0
author: Agent
platforms: [macos, linux]
metadata:
  tags: [ai-workflow, deployment, automation, cursor, codex, pipeline]
---

# AI 产物自动流转管道（2026-08-05 搭建）

## 触发场景

用户让 Cursor/Codex 改代码后，不想再手动"复制报告发给杰西卡 / 发 zip 部署"——让 AI 产物自动流转，用户只做最终拍板。

## 审查门禁（方案 A，2026-08-05 用户要求加）

**原则：部署不能全自动，必须有"审报告 → 用户确认 → 才部署"的人工节点。**

- cron 只跑 `--check`（检测 incoming 新 zip → 标记 pending + 通知），**不自动部署**
- 部署 = 用户确认后手动跑：`bash /root/deploy-all.sh --deploy [项目名]`
- **只对项目部署包（zip）生效**——文档修改（context/PRD/AGENTS.md）走 git，不进 incoming，永不触发部署

**完整流程**：
```
AI 改完 → rsync 上传 zip 到 incoming
→ cron --check 检测到 → pending + 通知用户"有包待部署"
→ 用户喊审 → 杰西卡读自检报告 + 审核 → digest
→ 用户说"部署" → 手动跑 bash /root/deploy-all.sh --deploy <项目>
→ 部署 + 验证 200 → 上线 → 用户实测
```

**deploy-all.sh 用法**：
- `bash /root/deploy-all.sh --check`（cron 用，只检测不部署）
- `bash /root/deploy-all.sh --deploy`（部署全部 pending 包）
- `bash /root/deploy-all.sh --deploy forge-erp`（只部署指定项目）

## 核心架构（两条管道，弱耦合，不用 A2A）

```
Cursor/Codex 改完
  ├── 管道 1（部署）：build zip → rsync 上传 → VPS cron 检测 → 自动部署 → 热更新生效
  └── 管道 2（报告）：生成自检报告.md → curl 上传 → 杰西卡读目录审核 → digest 给用户
用户只做：发指令 + 最后实测（APK 刷新/浏览器验证）
```

**设计原则**：不用 A2A（试过不成熟）、不用 git 做管道（脏数据）——用"文件/HTTP 弱耦合"，AI 只往管道写，审核方从管道读。

## 管道 1：自动部署（Mac → VPS）

### 已就绪组件

| 组件 | 位置 | 说明 |
|---|---|---|
| SSH key | Mac `~/.ssh/id_ed25519_vps` | 免密连 VPS（公钥已加 VPS authorized_keys） |
| incoming 目录 | VPS `/var/www/pmlophy.com/jarvis-voice-incoming/` | Mac rsync 上传目标 |
| 部署脚本 | VPS `/root/deploy-jarvis-voice.sh` | 检测新 zip → 解压 → 替换 → 验证 200 → 归档 |
| cron | VPS 每分钟 | `*/1 * * * * bash /root/deploy-jarvis-voice.sh` |

### 上传命令（Cursor 指令模板里用）

```bash
rsync -avz -e "ssh -p 2222 -i ~/.ssh/id_ed25519_vps" "/Users/liulongfei/个人文件/lophy-jarvis-voice/jarvis-voice.zip" root@192.220.14.245:/var/www/pmlophy.com/jarvis-voice-incoming/
```

### 部署脚本要点（deploy-jarvis-voice.sh）

- 找 incoming 最新 zip → 检查 backup 是否同名（已部署过则跳过+删除）
- 解压到 tmp → python 修正相对路径（`/assets/`→`./assets/`、worklet 路径、`/api-server`→`/p/jarvis`）
- 备份当前线上 → 部署新版 → curl 验证 200 → 归档 zip 到 backup/
- 验证失败自动回滚（备份恢复）
- 日志：`/var/log/jarvis-deploy.log`

## 管道 2：自检报告（AI → 杰西卡）

### 提交方式

```bash
curl -X POST "https://pmlophy.com/p/jarvis/file/upload" \
  -H "X-Jarvis-User: ai-reports" \
  -F "file=@{报告文件名}"
```

- 服务：jarvis-file（8871，nginx `/p/jarvis/file` → 8871/file）
- 落盘：`/var/lib/jarvis/files/ai-reports/{时间戳}-{文件名}`
- 命名规范：`{项目}-{任务}-{时间}.md`

### 报告模板（给 AI 的指令里强制）

```markdown
# AI 自检报告
- 项目/任务：
- 改动文件清单：
- 每个改动点说明：
- 自检结果（build/测试是否通过）：
- 遗留风险/待确认：
```

### 审核流程

用户喊"审报告" → 杰西卡读 `/var/lib/jarvis/files/ai-reports/` → 逐份审核 → 出 digest（改动是否合理/风险/下一步）→ 用户拍板。

## Cursor 指令模板（完整追加段）

```plaintext
【完成后必做：上传产物 + 自检报告】
1. build 完成后上传 zip（复制执行）：
   rsync -avz -e "ssh -p 2222 -i ~/.ssh/id_ed25519_vps" "/Users/liulongfei/个人文件/lophy-jarvis-voice/jarvis-voice.zip" root@192.220.14.245:/var/www/pmlophy.com/jarvis-voice-incoming/
2. 生成自检报告（模板见上）→ 上传：
   curl -X POST "https://pmlophy.com/p/jarvis/file/upload" -H "X-Jarvis-User: ai-reports" -F "file=@报告.md"
3. 完成后在回复里附上报告文件名
```

## Pitfalls

- **VPS sshd 默认 PubkeyAuthentication no**——配免密必须先改 `/etc/ssh/sshd_config` 为 yes 并 restart ssh（本次踩坑：key 加了但一直要密码）
- **zip 路径**：Cursor 的 zip 在项目**根目录**（不是 app/），rsync 路径要写对
- **中文路径**：Mac 路径 `/Users/liulongfei/个人文件/...` 要加引号
- **部署脚本幂等**：同名 zip 已归档则跳过，避免重复部署
- **cron 每分钟**：脚本无新包时静默退出（不刷日志），有包才部署
- **nginx /p/jarvis/file**：映射到 8871/file（带 /file 后缀），直接连 8871 会 404
- **验证**：部署后必须 curl 200 + 日志确认，不能只看 rsync 成功
- **VPS IP 动态**：192.220.14.245 可能变，变了要更新 rsync 命令和 known_hosts（先用 `curl -s ifconfig.me` 确认）
