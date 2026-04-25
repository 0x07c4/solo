# Solo UI DDD · Design Direction Document

最后更新：2026-04-25

## 0. Chair Decision

本次 DDD 的裁决版方向：

> Solo 是个人 agent workstream 的治理 cockpit，不是 ChatGPT 外壳、不是 IDE、也不是泛 dashboard。

最终组合命名：

| 层面 | 名称 | 含义 |
| --- | --- | --- |
| 信息架构 | Workstream Cockpit | 以 workstream/task/run/event 为主对象组织界面 |
| 视觉语言 | Signal Workshop | 温暖、克制、状态信号清晰的个人 agent 作战台 |
| 默认主题 | ops-dark | 从 gruvbox 暖色继承气质，但用更清楚的语义色分层 |

之前做的外部 Codex 监控不是主线设计，只是 `Resource / External Run` 的一个实例。它应该被统一纳入资源与 run 观察系统，而不是单独长成一个右下角插件。

## 1. 会议输入

| 席位 | 结论摘要 |
| --- | --- |
| Product IA | 主界面应从 chat/message 改为 workstream/task/run/event 对象模型。聊天降级为 commentary/event projection。 |
| Visual System | 采用 `Signal Workshop`，保留温暖开发工具气质，但避免整屏棕色糊成一片。状态色必须语义化。 |
| Interaction / Status | 核心路径是创建任务、监督 run、处理异常、查看资源、介入决策。Command Bar 是状态化控制台，不是普通聊天输入框。 |
| Engineering Constraints | 当前 `App.jsx` 状态复杂，不适合一次性重写。先做 token 和 shell redesign，再逐区替换，行为契约保持不变。 |

## 2. Goals

本轮 UI DDD 要解决：

| 目标 | 说明 |
| --- | --- |
| 任务治理 | 用户能看到当前有哪些目标、任务、run 和决策点 |
| run 监督 | 用户能快速判断 run 是否正常、是否卡住、下一步意图是什么 |
| 异常处理 | 异常要聚合成 incident，而不是散落在消息流里 |
| 资源协调 | workspace、外部 Codex、工具、文件范围、权限都要有清楚占用态 |
| artifact 追溯 | 结果、diff、预览、checkpoint 要成为一等对象 |
| 人类介入 | 用户在关键节点 approve、redirect、pause、abort、take over |

## 3. Non-goals

| 非目标 | 原因 |
| --- | --- |
| 把聊天做得更像 ChatGPT | Solo 的价值不是长消息，而是可监督的工作流 |
| 做成伪 IDE | 文件树和编辑器不是主导航，不能吞掉 workstream 结构 |
| 堆一个 dashboard | dashboard 只显示信息，不足以表达控制边界和介入点 |
| 用炫技动效包装 | 动效只服务状态变化和空间连续性 |
| 立即重写 runtime | 本轮先重构视觉和交互投影，不碰后端契约 |

## 4. Product Model

主对象模型固定为：

```text
Workstream
  Task
    Run
      Event
      Checkpoint
      Exception
      Artifact
  Resource
```

对象定义：

| 对象 | UI 含义 |
| --- | --- |
| Workstream | 一个持续目标或工作流容器，例如“重设计 Solo UI” |
| Task | 可执行任务，用户可以确认、拆分、排序 |
| Run | 一次 agent 执行实例，可以 managed 或 observe-only |
| Event | run 内的结构化事实，替代长聊天流 |
| Checkpoint | 需要用户确认的关键节点，例如计划、diff、权限、发布 |
| Exception | 被聚合后的异常事件，有影响面和恢复动作 |
| Artifact | 产物，例如设计稿、diff、文件、截图、日志摘要 |
| Resource | workspace、external codex、工具、文件范围、权限、上下文预算 |

必须降级的旧对象：

| 旧对象 | 新位置 |
| --- | --- |
| Chat message list | Event / Commentary 子区，默认摘要化 |
| 右下角 external dock | Resource / External Run |
| provider raw event | 按需展开的 log detail |
| 文件树 | Resource inspector，不是主导航 |
| 方向卡 | Checkpoint / Artifact Preview |
| 工具调用详情 | Timeline row 的可展开 evidence |

## 5. Information Architecture

推荐主布局：

```text
┌────────────────────────────────────────────────────────────────────┐
│ Topbar: workspace / health / counts / auth / control boundary       │
├──────────────┬───────────────────────────────────────┬─────────────┤
│ Left Rail    │ Workstream Cockpit                    │ Inspector   │
│              │                                       │ on demand   │
│ Workstreams  │ Task Board / Active Run / Timeline    │             │
│ Exceptions   │ Checkpoints / Artifacts               │ Evidence    │
│ Resources    │                                       │ Files       │
├──────────────┴───────────────────────────────────────┴─────────────┤
│ Command Bar: create task / intervene / approve / recover            │
└────────────────────────────────────────────────────────────────────┘
```

### 5.1 Topbar

Topbar 只放全局事实和控制边界：

| 区域 | 内容 |
| --- | --- |
| Identity | `solo / control plane`、当前 workspace、branch 或 project |
| Global Health | active runs、waiting approvals、exceptions、resource pressure |
| Control Boundary | Codex 登录态、managed/observe-only 汇总、pause/resume |
| Search / Command | 全局搜索、command palette 入口 |

Topbar 不承载长标题，不承载具体任务详情。

### 5.2 Left Rail

Left Rail 是对象导航，不是聊天列表：

| 分区 | 内容 |
| --- | --- |
| Workstreams | active / waiting / done，显示任务数、run 数、异常数 |
| Exceptions | incident inbox，按影响面排序 |
| Resources | workspace、external codex、tool/file scope、observe-only resources |

资源栏承担 external Codex occupancy。Topbar 只显示 count。

### 5.3 Center

Center 是 `Workstream Cockpit`：

| 区块 | 内容 |
| --- | --- |
| Workstream Header | 目标、当前任务、run 状态、下一步意图 |
| Task Board | backlog / in progress / waiting / done |
| Active Run | 当前 run 摘要、计划进度、最新事件、风险 |
| Timeline | events、tool summaries、checkpoints、exceptions |
| Artifact Strip | diff、preview、file、screenshot、design doc |

中心不应该默认显示整段 ChatGPT 回复。长文本只在展开时出现。

### 5.4 Inspector

Inspector 默认按需显示：

| Tab | 内容 |
| --- | --- |
| Evidence | 原始命令、stdout 摘要、tool args、事件详情 |
| Files | 相关文件、diff、workspace tree 局部视图 |
| Artifacts | 产物预览、OpenPencil 文件、截图、文档 |
| Resource | 外部 Codex、权限、上下文预算、工具占用 |

Inspector 不应该变成常驻第二主屏。它是证据层。

### 5.5 Command Bar

Command Bar 是状态化控制台：

| 状态 | 主动作 |
| --- | --- |
| No task | 创建任务 |
| Draft task | 确认任务、选择执行模式、设定权限边界 |
| Running | 追加约束、重定向、暂停 |
| Waiting approval | approve / reject / revise |
| Blocked | retry / change scope / ask / stop |
| Exception | recover / skip / abort / take over |
| Observe-only | 只允许 comment / convert to local task |

Command Bar 固定底部，但内容随状态变化。不要再把它设计成普通聊天输入框。

## 6. Visual Direction

视觉方向：`Signal Workshop`

关键词：

| 关键词 | 含义 |
| --- | --- |
| Warm | 继承 gruvbox / terminal 的个人工具温度 |
| Signal-first | 状态色是信息，不是装饰 |
| Dense but calm | 信息密度高，但层级清楚，不焦躁 |
| Instrument panel | 像仪表台，不像社交聊天窗口 |
| Human-in-loop | 关键按钮和 checkpoint 有明确介入感 |

反方向清单：

| 避免 | 原因 |
| --- | --- |
| 整屏棕色糊成一片 | 状态不可读，层级弱 |
| generic SaaS card | 会把 Solo 变成普通 dashboard |
| neon terminal cosplay | 过度风格化，降低长期可用性 |
| chat bubble 主导 | 把对象模型重新拉回对话 |
| badge 彩虹化 | 状态语义不稳定 |
| 纯色表达状态 | 可访问性差，必须有文字/图形辅助 |

## 7. Color System

默认主题名：`ops-dark`

### 7.1 Primitive / Semantic Tokens

```css
:root[data-theme="ops-dark"] {
  --bg: #151714;
  --panel: #1e211c;
  --card: #262a23;
  --card-raised: #2d322a;

  --text: #e8e1d2;
  --text-soft: #c9bfae;
  --muted: #8e8576;
  --muted-2: #6f675c;

  --border: #3a3f35;
  --border-strong: #535a4d;

  --accent: #d79921;
  --accent-soft: #3a2f19;

  --active: #a9b665;
  --active-soft: #29311d;
  --waiting: #d8a657;
  --waiting-soft: #3a2b18;
  --error: #ea6962;
  --error-soft: #3a1f1d;
  --resource: #89b482;
  --resource-soft: #203322;
  --external: #7daea3;
  --external-soft: #1f3130;

  --selection: #3b4434;
  --focus-ring: #d79921;
}
```

### 7.2 State Mapping

| State | Color | Shape rule |
| --- | --- | --- |
| active / running | `--active` | left state bar + compact pill |
| waiting / approval | `--waiting` | amber pill + action chip |
| error / exception | `--error` | red state bar + incident block |
| resource / workspace | `--resource` | resource card + occupancy meter |
| external / observe-only | `--external` | dashed boundary + disabled controls |
| selected | `--selection` | raised card + strong border |
| focus | `--focus-ring` | 2px visible ring |

颜色不能单独表达状态。每个状态都必须同时有 label、形状或 icon cue。

## 8. Typography

推荐字体：

```css
:root {
  --font-ui: "IBM Plex Sans", "Noto Sans SC", sans-serif;
  --font-mono: "Berkeley Mono", "JetBrains Mono", "IBM Plex Mono", monospace;
  --font-display: "IBM Plex Sans Condensed", "Noto Sans SC", sans-serif;
}
```

使用规则：

| 用途 | 字体 |
| --- | --- |
| 页面标题 / section label | `--font-display` |
| 正文 / 操作说明 | `--font-ui` |
| path / pid / timestamp / command | `--font-mono` |
| badge label | `--font-mono` + uppercase 或短中文 |

当前“全局接近 mono”的风格需要降级。Mono 只用于机器信息，正文需要更易读。

## 9. Component Rules

### 9.1 Workstream Card

必须显示：

| 字段 | 说明 |
| --- | --- |
| title | 用户目标 |
| mode | managed / observe-only / pure chat |
| active run count | 当前执行情况 |
| waiting count | 是否等用户 |
| exception count | 是否有 incident |
| resource badge | workspace 或 external occupancy |

选中态使用左侧 2px state bar、raised card、strong border。不要整卡黄底。

### 9.2 Run Row

必须显示：

| 字段 | 说明 |
| --- | --- |
| run source | local codex / external codex / pure chat |
| state | active / waiting / blocked / done / failed |
| next intent | 下一步计划或当前卡点 |
| last event time | 最近变化 |
| control boundary | managed 或 observe-only |

### 9.3 Event Row

Event Row 是消息流的替代品：

| 类型 | 展示 |
| --- | --- |
| thought / summary | 一行摘要，可展开 |
| command | command name + result + duration |
| file change | path + change kind |
| checkpoint | emphasized card |
| exception | incident card |

长文本默认折叠，避免中轴被聊天内容淹没。

### 9.4 Checkpoint Card

Checkpoint 是 Solo 的核心交互对象。

必须包含：

| 字段 | 说明 |
| --- | --- |
| decision | 用户需要决定什么 |
| impact | 影响哪些文件、资源或 run |
| options | approve / revise / reject / inspect |
| evidence | 可展开证据 |

### 9.5 Exception Incident

Exception 不再只是红色 toast。它应该被聚合为 incident：

| 字段 | 说明 |
| --- | --- |
| severity | warning / blocked / failed |
| impact | 当前任务、run、文件或资源受影响范围 |
| recovery options | retry / change scope / skip / ask / abort |
| evidence | 最近失败事件和命令摘要 |

### 9.6 Resource Card

Resource Card 统一 workspace、external Codex、tool、file scope：

| 字段 | 说明 |
| --- | --- |
| type | workspace / external / tool / file scope |
| ownership | managed / observe-only |
| status | active / idle / waiting / unknown |
| binding | 关联 workstream 或 untracked |
| action | inspect / attach / convert / release |

外部 Codex 规则：

| 情况 | UI 处理 |
| --- | --- |
| workspace 匹配已知 workstream | 附着到该 workstream 的 Resource 区 |
| workspace 未匹配 | 放入 `Untracked` 资源组 |
| observe-only | 控制按钮 disabled，只能 comment 或 convert |
| pid / cwd / started time | 用 mono 小号展示 |

## 10. Core Flows

### 10.1 Create Task

```text
input goal
  -> task draft
  -> confirm scope
  -> choose execution mode
  -> confirm permission boundary
  -> start run
```

### 10.2 Supervise Run

```text
run active
  -> summary + next intent
  -> timeline events
  -> checkpoint when needed
  -> artifact preview
  -> done / exception
```

### 10.3 Handle Exception

```text
exception event
  -> incident aggregation
  -> impact statement
  -> recovery options
  -> user decision
  -> recorded resolution
```

### 10.4 Observe External Codex

```text
process discovered
  -> workspace match
  -> external run/resource card
  -> observe-only boundary
  -> optional convert to managed task
```

## 11. Empty / Loading / Error States

| State | UI rule |
| --- | --- |
| empty workstream | show task creation affordance and one-line explanation |
| empty run | show no active run, not skeleton forever |
| loading resources | shimmer only inside Resource section |
| external unknown | show `workspace unknown` and disable attach |
| observe-only | visible dashed boundary and disabled control buttons |
| blocked | command bar switches to recovery choices |
| failed request | inline incident in relevant section, not only toast |

## 12. Engineering Plan

### Phase 0 · Preserve Behavior

不改：

| 不改内容 | 原因 |
| --- | --- |
| `desktop` API contract | 避免触发 Tauri/CLI 回归 |
| stream event names | 保持运行链路稳定 |
| session lifecycle | 当前状态复杂，不能一次性推翻 |
| backend models | 本轮目标是 UI projection |

### Phase 1 · Token Layer

先在 `src/App.css` 建 alias token 层：

```css
:root {
  --app-bg: var(--bg);
  --app-panel: var(--panel);
  --app-card: var(--card);
  --app-card-raised: var(--card-raised);
  --app-text: var(--text);
  --app-text-muted: var(--muted);
  --app-border: var(--border);
  --app-focus: var(--focus-ring);
}
```

同时统一状态 token：

```css
:root {
  --tone-active: var(--active);
  --tone-active-bg: var(--active-soft);
  --tone-waiting: var(--waiting);
  --tone-waiting-bg: var(--waiting-soft);
  --tone-error: var(--error);
  --tone-error-bg: var(--error-soft);
  --tone-resource: var(--resource);
  --tone-resource-bg: var(--resource-soft);
  --tone-external: var(--external);
  --tone-external-bg: var(--external-soft);
}
```

### Phase 2 · Shell Redesign

只改外观壳，不改业务行为：

| 区域 | 动作 |
| --- | --- |
| topbar | 改成 global health / counts / control boundary |
| workspace shell | 明确 left / center / inspector / command bar |
| cards | 统一 border、radius、state bar、selected state |
| typography | 正文切到 UI font，机器信息保留 mono |

### Phase 3 · Section Redesign

按风险从低到高：

| 顺序 | 区域 |
| --- | --- |
| 1 | Center header + task/run summaries |
| 2 | Timeline / event rows |
| 3 | Resource section，包括 external Codex |
| 4 | Exceptions inbox |
| 5 | Command Bar state machine |
| 6 | Inspector tabs |

### Phase 4 · Component Extraction

只在视觉稳定后拆组件：

| Component | 目标 |
| --- | --- |
| `WorkstreamCard` | 左侧对象卡 |
| `RunTimeline` | run event 投影 |
| `CheckpointCard` | 用户决策节点 |
| `IncidentCard` | 异常聚合 |
| `ResourceCard` | workspace/external/tool/file |
| `CommandBar` | 状态化控制台 |

状态仍先留在 `App.jsx`，不要同时做 reducer 重构。

## 13. Implementation Rulings

| 问题 | 裁决 |
| --- | --- |
| 主界面中心叫什么 | `Workstream Cockpit` |
| 聊天是否默认隐藏 | 降级为 Event / Commentary 子区，长文本默认折叠 |
| Command Bar 位置 | 固定底部，按状态切换动作 |
| Resources 职责 | 承担 workspace 和 external agent occupancy |
| 默认 theme | 新建 `ops-dark`，不要继续直接叫 `gruvbox-dark` |
| 本轮是否重构 token | 是，先 CSS alias token，再改 JSX |
| 外部 Codex 怎么显示 | Resource / External Run，observe-only 明确标记 |
| 是否立即生成 OpenPencil 全稿 | 作为下一步，用本 DDD 做 overview 画布 |

## 14. OpenPencil Overview Brief

下一步 overview 画布应展示 1 个主屏，而不是局部卡片：

| 区域 | 画布内容 |
| --- | --- |
| Topbar | global health, exceptions, resources, Codex auth |
| Left Rail | workstreams, exceptions, resources with external Codex |
| Center | Workstream Cockpit: task board + active run + timeline |
| Inspector | artifact/evidence/resource tabs |
| Command Bar | state-aware intervention controls |

画布目标：

| 目标 | 判断标准 |
| --- | --- |
| 一眼看出不是 chat app | 中心是 run/timeline/checkpoint，不是消息气泡 |
| 一眼看出状态 | active/waiting/error/resource/external 语义明显 |
| 一眼看出控制边界 | observe-only 与 managed 视觉不同 |
| 一眼看出用户可介入 | command bar 和 checkpoint 有明确动作 |

## 15. Success Criteria

这轮 redesign 成功的标准：

| 标准 | 说明 |
| --- | --- |
| 5 秒理解当前局面 | 用户能判断有没有 run、有没有异常、需不需要介入 |
| 30 秒定位证据 | 用户能从 event 进入 command/file/artifact evidence |
| 外部 agent 不混淆 | observe-only 永远不会被误解为可控制 |
| 聊天不抢主线 | 长消息不会占据中心主视角 |
| 主题可维护 | 状态色、surface、text、border 都走 semantic token |
| 工程风险可控 | 第一阶段不碰 runtime 和 backend contract |
