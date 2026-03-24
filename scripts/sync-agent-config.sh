#!/usr/bin/env bash

set -euo pipefail

CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
REMOTE_URL="${SYNC_REMOTE_URL:-git@github.com:0x07c4/agent.git}"
GIT_NAME="${SYNC_GIT_NAME:-0x07c4}"
GIT_EMAIL="${SYNC_GIT_EMAIL:-0x07c4@users.noreply.github.com}"
COMMIT_MESSAGE="${SYNC_COMMIT_MESSAGE:-chore: sync codex configuration}"
KEEP_TEMP="${SYNC_KEEP_TEMP:-0}"
DRY_RUN="${SYNC_DRY_RUN:-0}"
TMP_ROOT="${TMPDIR:-/tmp}"
WORK_DIR="$(mktemp -d "${TMP_ROOT%/}/agent-sync.XXXXXX")"
EXPORT_DIR="$WORK_DIR/export"
REPO_DIR="$WORK_DIR/repo"
HOME_PATTERN="${HOME//|/\\|}"
SCAN_PATTERN='eyJ[A-Za-z0-9._-]{20,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}'
SCAN_EMAIL="${SYNC_SCAN_EMAIL:-$(git config --global user.email 2>/dev/null || true)}"
SCRIPT_SOURCE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/$(basename -- "${BASH_SOURCE[0]}")"

usage() {
  cat <<'EOF'
Usage: sync-agent-config.sh [options] [remote]

Options:
  --dry-run           Export and scan only; do not commit or push
  --keep-temp         Keep the temporary workspace after exit
  --remote URL        Push target remote URL
  --codex-home PATH   Codex home directory to export from
  --help              Show this help

Environment overrides:
  SYNC_REMOTE_URL
  SYNC_GIT_NAME
  SYNC_GIT_EMAIL
  SYNC_COMMIT_MESSAGE
  SYNC_KEEP_TEMP=1
  SYNC_DRY_RUN=1
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      --keep-temp)
        KEEP_TEMP=1
        shift
        ;;
      --remote)
        [[ $# -ge 2 ]] || {
          printf 'Missing value for --remote\n' >&2
          exit 1
        }
        REMOTE_URL="$2"
        shift 2
        ;;
      --codex-home)
        [[ $# -ge 2 ]] || {
          printf 'Missing value for --codex-home\n' >&2
          exit 1
        }
        CODEX_HOME="$2"
        shift 2
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      -*)
        printf 'Unknown option: %s\n' "$1" >&2
        usage >&2
        exit 1
        ;;
      *)
        REMOTE_URL="$1"
        shift
        ;;
    esac
  done
}

cleanup() {
  if [[ "$KEEP_TEMP" == "1" ]]; then
    printf 'Temporary workspace kept at %s\n' "$WORK_DIR"
    return
  fi

  rm -rf "$WORK_DIR"
}

trap cleanup EXIT

log() {
  printf '[sync-agent-config] %s\n' "$*"
}

copy_if_exists() {
  local src="$1"
  local dst="$2"

  if [[ -e "$src" ]]; then
    mkdir -p "$(dirname "$dst")"
    cp -R "$src" "$dst"
  fi
}

sanitize_config() {
  local src="$CODEX_HOME/config.toml"
  local dst="$EXPORT_DIR/config.toml"

  [[ -f "$src" ]] || return 0

  mkdir -p "$(dirname "$dst")"
  awk '
    /^\[projects\./ { in_projects = 1; next }
    in_projects && /^\[/ { in_projects = 0 }
    !in_projects { print }
  ' "$src" > "$dst"
}

copy_rules() {
  if [[ -d "$CODEX_HOME/rules" ]]; then
    cp -R "$CODEX_HOME/rules" "$EXPORT_DIR/rules"
  fi
}

copy_memories() {
  if [[ -d "$CODEX_HOME/memories" ]]; then
    cp -R "$CODEX_HOME/memories" "$EXPORT_DIR/memories"
  fi
}

copy_agents() {
  copy_if_exists "$CODEX_HOME/AGENTS.md" "$EXPORT_DIR/AGENTS.md"
}

copy_sync_helper() {
  mkdir -p "$EXPORT_DIR/bin"
  cp "$SCRIPT_SOURCE" "$EXPORT_DIR/bin/sync-agent-config.sh"
  chmod 755 "$EXPORT_DIR/bin/sync-agent-config.sh"
}

copy_non_system_skills() {
  local skill_dir

  [[ -d "$CODEX_HOME/skills" ]] || return 0

  mkdir -p "$EXPORT_DIR/skills"
  shopt -s nullglob
  for skill_dir in "$CODEX_HOME"/skills/*; do
    [[ -d "$skill_dir" ]] || continue
    [[ "$(basename "$skill_dir")" == ".system" ]] && continue
    cp -R "$skill_dir" "$EXPORT_DIR/skills/"
  done
}

rewrite_home_paths() {
  local file

  while IFS= read -r -d '' file; do
    if grep -Iq . "$file"; then
      sed -i "s|$HOME_PATTERN|\\\$HOME|g" "$file"
    fi
  done < <(find "$EXPORT_DIR" -type f -print0)
}

write_systemd_units() {
  mkdir -p "$EXPORT_DIR/systemd"

  cat > "$EXPORT_DIR/systemd/sync-agent-config.service" <<'EOF'
[Unit]
Description=Sync Codex agent config snapshot

[Service]
Type=oneshot
ExecStart=%h/.codex/bin/sync-agent-config.sh
EOF

  cat > "$EXPORT_DIR/systemd/sync-agent-config.timer" <<'EOF'
[Unit]
Description=Run Codex agent config sync daily

[Timer]
OnCalendar=daily
Persistent=true
Unit=sync-agent-config.service

[Install]
WantedBy=timers.target
EOF
}

write_systemd_doc() {
  mkdir -p "$EXPORT_DIR/docs"

  cat > "$EXPORT_DIR/docs/systemd-sync.md" <<'EOF'
# systemd user 定时同步

这套配置只做一件事：每天用 `systemd --user` 调一次 `$HOME/.codex/bin/sync-agent-config.sh`。

## 安装脚本

先把同步脚本放到本机：

```bash
mkdir -p "$HOME/.codex/bin"
install -m 755 ./bin/sync-agent-config.sh "$HOME/.codex/bin/sync-agent-config.sh"
```

## 安装 unit

```bash
mkdir -p "$HOME/.config/systemd/user"
cp ./systemd/sync-agent-config.service "$HOME/.config/systemd/user/"
cp ./systemd/sync-agent-config.timer "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now sync-agent-config.timer
```

## 验证

```bash
systemctl --user status sync-agent-config.timer
systemctl --user list-timers sync-agent-config.timer
```
EOF
}

write_readme() {
  cat > "$EXPORT_DIR/README.md" <<'EOF'
# Agent Config Snapshot

This repository stores a sanitized snapshot of a local Codex setup.

Included:
- `AGENTS.md`
- `bin/sync-agent-config.sh`
- `systemd/`
- `docs/systemd-sync.md`
- `config.toml` with local project trust blocks removed
- `rules/`
- `memories/`
- non-system skills from `~/.codex/skills`

Excluded:
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

Notes:
- local home paths are rewritten to `$HOME`
- this snapshot is meant for backup and portability, not full runtime state sync

## Manual sync

Use the installed helper:

```bash
$HOME/.codex/bin/sync-agent-config.sh
```

Or run the repo copy directly:

```bash
./bin/sync-agent-config.sh --dry-run
```

See `docs/systemd-sync.md` for the daily `systemd --user` timer setup.
EOF
}

write_gitignore() {
  cat > "$EXPORT_DIR/.gitignore" <<'EOF'
auth.json
history.jsonl
session_index.jsonl
sessions/
log/
logs_*.sqlite*
state_*.sqlite*
models_cache.json
tmp/
shell_snapshots/
EOF
}

scan_export() {
  log "running privacy scan"
  if command -v rg >/dev/null 2>&1; then
    if rg -n "$SCAN_PATTERN|$HOME_PATTERN" "$EXPORT_DIR" -S; then
      printf 'Sensitive data detected in export. Aborting.\n' >&2
      exit 1
    fi
    if [[ -n "$SCAN_EMAIL" ]] && rg -n -F "$SCAN_EMAIL" "$EXPORT_DIR"; then
      printf 'Sensitive email detected in export. Aborting.\n' >&2
      exit 1
    fi
    return
  fi

  if grep -RInE "$SCAN_PATTERN|$HOME_PATTERN" "$EXPORT_DIR"; then
    printf 'Sensitive data detected in export. Aborting.\n' >&2
    exit 1
  fi
  if [[ -n "$SCAN_EMAIL" ]] && grep -RInF "$SCAN_EMAIL" "$EXPORT_DIR"; then
    printf 'Sensitive email detected in export. Aborting.\n' >&2
    exit 1
  fi
}

prepare_repo() {
  mkdir -p "$REPO_DIR"
  git init -b main "$REPO_DIR" >/dev/null
  git -C "$REPO_DIR" config user.name "$GIT_NAME"
  git -C "$REPO_DIR" config user.email "$GIT_EMAIL"
  git -C "$REPO_DIR" remote add origin "$REMOTE_URL"

  if git -C "$REPO_DIR" fetch --quiet origin main; then
    git -C "$REPO_DIR" checkout -B main origin/main >/dev/null 2>&1
  else
    git -C "$REPO_DIR" checkout -B main >/dev/null 2>&1
  fi

  find "$REPO_DIR" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
  cp -R "$EXPORT_DIR"/. "$REPO_DIR"/
}

commit_and_push() {
  git -C "$REPO_DIR" add -A

  if git -C "$REPO_DIR" diff --cached --quiet; then
    log "no changes to sync"
    return 0
  fi

  git -C "$REPO_DIR" commit -m "$COMMIT_MESSAGE" >/dev/null
  git -C "$REPO_DIR" push -u origin main
}

report_dry_run() {
  log "dry run complete"
  log "export directory: $EXPORT_DIR"
  log "remote target: $REMOTE_URL"
  find "$EXPORT_DIR" -maxdepth 4 -type f | sort
}

main() {
  parse_args "$@"
  log "exporting sanitized Codex snapshot from $CODEX_HOME"

  mkdir -p "$EXPORT_DIR"
  sanitize_config
  copy_rules
  copy_memories
  copy_agents
  copy_sync_helper
  copy_non_system_skills
  write_systemd_units
  write_systemd_doc
  rewrite_home_paths
  write_readme
  write_gitignore
  scan_export

  if [[ "$DRY_RUN" == "1" ]]; then
    report_dry_run
    return 0
  fi

  prepare_repo
  commit_and_push

  log "sync complete"
}

main "$@"
