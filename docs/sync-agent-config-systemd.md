# systemd user 定时同步

这套配置只做一件事：每天用 `systemd --user` 调一次 `~/.codex/bin/sync-agent-config.sh`。

## 文件

- `scripts/sync-agent-config.service`
- `scripts/sync-agent-config.timer`

## 安装

把两个 unit 文件放到用户级 systemd 目录：

```bash
mkdir -p ~/.config/systemd/user
cp /home/chikee/workspace/solo/scripts/sync-agent-config.service ~/.config/systemd/user/
cp /home/chikee/workspace/solo/scripts/sync-agent-config.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now sync-agent-config.timer
```

## 验证

```bash
systemctl --user status sync-agent-config.timer
systemctl --user list-timers sync-agent-config.timer
```

## 说明

- service 只执行 `~/.codex/bin/sync-agent-config.sh`
- timer 使用 `OnCalendar=daily`
- 日志走默认 journal，脚本本身已经输出很短的前缀日志
