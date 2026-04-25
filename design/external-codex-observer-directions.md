# External Codex Observer · UI Design Directions

## 设计结论

推荐方向：`B · Resource Rail Integration`

原因很直接：外部 Codex 的本质不是一条消息，也不是一个弹窗事件，而是一个正在占用 workspace 的外部 run。它应该进入 Solo 的资源视图，而不是漂浮在主界面上。

当前右下角 `运行雷达` 可以保留为调试/过渡形态，但不应成为长期 UI。

## Huashu 四问

### 叙事角色

`External Codex Observer` 是资源占用与运行状态提示，不是主任务内容。

它回答的问题是：

- 当前有没有外部 agent 正在跑？
- 它跑在哪个 workspace？
- Solo 能不能控制它？
- 如果有关联会话，用户能不能快速跳过去？

### 观众距离

桌面开发工具，约 60-90cm。

信息密度可以高，但必须可扫读。状态字段应短、强结构化，不使用长解释。

### 视觉温度

冷静、可靠、克制。

不能做成告警弹窗，除非外部 agent 失败或不可读。默认应该像系统资源监控，而不是聊天通知。

### 容量估算

单个 agent 卡片最多承载：

- workspace
- pid
- state
- cwd
- observe-only
- last seen
- one action

超过 3 个 agent 时需要折叠或分组，不能无限堆卡。

## Direction A · Right Dock Radar

### 定位

临时可视化、调试友好、快速发现。

### 适用场景

- 当前功能仍在验证
- 用户需要确认 `/proc` 扫描有没有生效
- 不想先大改左侧资源栏

### 形态

- 固定右下角
- 紧凑浮层
- 只显示最近 3 个外部 agent
- 强制显示 `observe-only`

### 风险

- 容易像插件浮窗
- 与 Solo control-plane 的信息架构不完全一致
- 多 agent 时拥挤

## Direction B · Resource Rail Integration

### 定位

长期产品方向。

外部 Codex 是 `Resource Occupancy`，不是 overlay。

### 结构

左侧 `RESOURCES / 附加资源` 区块改成资源状态列表：

```text
RESOURCES
附加资源  1

solo
local workspace
0 external runs

cocoa
external codex
pid 1234 · running
observe-only

UNTRACKED
/tmp/project-x
pid 9876 · sleeping
observe-only
```

### 状态层级

- `running`：绿色/active chip + 文字
- `sleeping`：muted/loading chip + 文字
- `unknown`：idle chip + 文字
- `observe-only`：永久显示，防止误解为可控制

### 交互

- 点击 workspace card：聚焦对应 workspace/session
- 无匹配 workspace：显示 `untracked external run`
- 不提供 `stop / approve / continue`

### 优点

- 与 Solo 的 resource / run / event 模型一致
- 不遮挡主内容
- 更容易扩展到多 agent
- 可以自然支持资源冲突和占用状态

## Direction C · Top Status Expansion

### 定位

全局状态摘要。

### 结构

顶栏 `RESOURCES` 卡片显示：

```text
RESOURCES
1 external / 0 attached
```

点击后展开：

```text
External Codex
cocoa       running    observe-only
/tmp/demo   sleeping   observe-only
```

### 优点

- 占用面积小
- 适合后续多 agent 汇总
- 和 control-plane 顶栏一致

### 风险

- 可发现性弱
- 用户需要点击才知道具体 workspace
- 不如左侧资源栏直观

## 设计护栏

- 不用大面积 blur。
- 不用装饰性动画。
- 不用颜色单独表达状态。
- 不把外部 Codex 称为 managed run。
- 不显示控制按钮，除非进程由 Solo 托管。
- 不隐藏 unmatched workspace。
- 不让当前 active workspace 过滤掉其他外部 agent。
- 不把资源状态塞进聊天消息流。

## 落地顺序

1. 保留当前右下 `运行雷达` 作为可见调试层。
2. 将同一份 observed agents projection 接入左侧 `RESOURCES`。
3. 左侧资源卡稳定后，移除或折叠右下浮层。
4. 最后再接顶栏 `RESOURCES` 汇总。

## 下一步实现建议

直接实现 Direction B。

实现范围：

- `src/App.jsx`
- `src/App.css`

不需要改 Rust。

Rust 已经提供 `codex_running_agents`，前端只需要重新投影。
