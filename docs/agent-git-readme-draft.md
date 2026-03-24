# agent.git README 草案

## 这是什么

`agent.git` 是一份本地 Codex 配置的脱敏快照仓库。

它的目标不是同步完整运行时状态，而是把可公开、可迁移的配置和记忆整理成一个可备份、可审查、可推送的 Git 仓库。

## 包含什么

当前同步脚本会导出这些内容：

- `AGENTS.md`
- `config.toml`，但会移除本地项目信任块
- `rules/`
- `memories/`
- `~/.codex/skills/` 下的非系统 skills

导出时还会做两件事：

- 把本机绝对路径重写为 `$HOME`
- 生成仓库内的 `README.md` 和 `.gitignore`，说明快照边界

## 排除什么

以下内容不会进入仓库：

- `auth.json`
- `history.jsonl`
- `session_index.jsonl`
- `sessions/`
- `log/`
- `logs_*.sqlite*`
- `state_*.sqlite*`
- `models_cache.json`
- `tmp/`
- `shell_snapshots/`

此外，导出后还会做敏感信息扫描，发现 token 形态内容或残留本机路径会直接中止。

## 如何手动同步

默认脚本是 `scripts/sync-agent-config.sh`。

常用方式：

```bash
./scripts/sync-agent-config.sh
```

可选参数：

```bash
./scripts/sync-agent-config.sh --remote git@github.com:0x07c4/agent.git
./scripts/sync-agent-config.sh --codex-home "$HOME/.codex"
./scripts/sync-agent-config.sh --keep-temp
```

也可以通过环境变量覆盖默认值：

- `SYNC_REMOTE_URL`
- `SYNC_GIT_NAME`
- `SYNC_GIT_EMAIL`
- `SYNC_COMMIT_MESSAGE`
- `SYNC_KEEP_TEMP=1`
- `SYNC_DRY_RUN=1`

脚本的默认行为是：

- 导出快照到临时目录
- 清理不该公开的状态
- 扫描敏感内容
- 初始化或更新临时 Git 仓库
- 提交并推送到 `origin/main`

## 如何 dry-run

只看导出结果和扫描结果，不提交、不推送：

```bash
./scripts/sync-agent-config.sh --dry-run
```

等价地，也可以：

```bash
SYNC_DRY_RUN=1 ./scripts/sync-agent-config.sh
```

如果你还想保留临时目录，叠加 `--keep-temp`。

## 隐私边界

这个仓库只接受“能公开的配置”，不接受运行态隐私数据。

明确边界如下：

- 不存登录态、token、历史会话、会话索引
- 不存临时文件、日志、缓存、数据库状态
- 不保留本机绝对路径
- 不把完整 runtime state 当成同步目标

换句话说，`agent.git` 是“可公开的 Codex 配置备份”，不是“本机 Codex 的完整镜像”。
