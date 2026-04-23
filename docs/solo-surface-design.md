# Solo 主界面设计

最后更新：2026-04-22

适用范围：

- 这份文档定义的是 `Solo` 下一阶段的主界面信息架构
- 它服务于产品设计、前端重构和 runtime 投影收束
- 它不替代总纲文档，而是把 [solo-control-plane.md](./solo-control-plane.md) 的方向落成页面层级

相关文件：

- 产品总纲：[solo-control-plane.md](./solo-control-plane.md)
- 当前架构：[solo-architecture.md](./solo-architecture.md)
- 当前前端实现：[App.jsx](/home/chikee/workspace/solo/src/App.jsx)
- 当前详情面板：[InspectorPane.jsx](/home/chikee/workspace/solo/src/components/InspectorPane.jsx)

## 1. 一句话判断

`Solo` 的主界面不能再以聊天为中心，而应以任务观测为中心。

更直接地说：

- 主区先展示 `task / run / event`
- 对话输入降级为次级控制入口
- 工作区不再是主模式，而是 `resource attach`

## 2. 当前问题

当前实现的主要矛盾不是视觉风格，而是页面主语义还停留在旧阶段：

- 左侧仍然是 `sessions + workspaces + explorer`
- 中间仍然是 `conversation stack`
- 右侧仍然是 `context / diff / command inspector`

这会导致几个问题：

- 用户天然把 `Solo` 理解成“带工作区的聊天工具”
- runtime snapshot 只出现在侧边角落，无法成为主叙事
- task、run、exception、resource 这些新语义没有主舞台
- 后续每加能力，都会继续往 chat shell 上补丁

所以这次界面调整的目标不是“换皮”，而是：

- 把主舞台从 message flow 切到 task governance

## 3. 设计原则

### 3.1 默认看任务，不默认看对话

- 首屏应该先回答“现在有哪些任务，在什么状态”
- 不是先展示一长串消息

### 3.2 默认看异常，不默认看细节

- 用户首先需要看到阻塞、失败、升级、超时
- 细节应该按需下钻，不该默认铺满全屏

### 3.3 默认看运行态，不默认看 prompt 产物

- UI 读取的是 runtime projection
- 文本回复、方向卡、预览卡都只是某类 event 或 artifact 的投影

### 3.4 资源是附加物，不是主模式

- 目录、文件、URL、需求文档、本地说明，都属于 resource
- “工作区协作”不应继续占据一级产品模式

### 3.5 人只在 checkpoint / exception 出现

- 不默认微操每一步
- 只有在高风险、偏航、阻塞、审批、改 scope 时，才把用户拉进来

## 4. 主界面信息架构

推荐的桌面主界面结构如下：

```text
┌ Top Bar ───────────────────────────────────────────────────────────────┐
│ Workstream / Active / Blocked / Exceptions / Budget / Controls        │
├ Left Rail ──────────────┬ Main Surface ─────────────────┬ Right Detail │
│ Workstreams             │ Task Board / Task List        │ Run Detail   │
│ Task Filters            │ Active Runs                   │ Event Trace  │
│ Exception Inbox         │ Run Timeline                  │ Artifacts    │
│ Resource Lens           │ Milestones / Risk Summary     │ Resources    │
├ Command Bar ──────────────────────────────────────────────────────────┤
│ New Task / Attach Resource / Intervene / Retry / Fork / Pause        │
└───────────────────────────────────────────────────────────────────────┘
```

### 4.1 Top Bar

顶栏只放全局观测和全局控制，不放页面局部信息。

应该显示：

- 当前 workstream
- 运行中 task 数
- blocked / failed / exception 数
- 当前资源占用
- provider / model / budget 摘要
- 全局动作入口

不应该继续强调：

- 当前是“对话模式”还是“工作区协作模式”
- 当前有没有绑某个目录作为产品核心状态

### 4.2 Left Rail

左侧是管理面，不是文件管理器优先。

建议分为四段：

- `Workstreams`
- `Tasks`
- `Exceptions`
- `Resources`

每段职责：

- `Workstreams`：项目脉络、长期上下文、跨任务切换
- `Tasks`：按 `Active / Blocked / Waiting / Done` 或优先级聚合
- `Exceptions`：失败、超时、待介入、待审批
- `Resources`：目录、文件、模型、权限、预算、agent worker

文件树可以保留，但应该退到 `Resources` 的子视图，而不是长期占据一级栏位。

### 4.3 Main Surface

中间主区是 `Solo` 的主舞台，承担三层表达：

- 当前 workstream 下的任务视图
- 选中 task 的活跃 run
- 当前 task 的时间线和状态推进

推荐结构：

- 上半区：`Task Board` 或 `Task List`
- 中段：`Active Runs`
- 下半区：`Run Timeline`

其中：

- `Task Board` 负责告诉用户“现在有哪些任务”
- `Active Runs` 负责告诉用户“哪些事情正在被 agent 执行”
- `Run Timeline` 负责告诉用户“这件事是怎么走到现在的”

### 4.4 Right Detail

右侧详情区不再叫 `Inspector`，而应直接是 `Run Detail`。

建议固定四个 tab：

- `Trace`
- `Artifacts`
- `Resources`
- `Controls`

各 tab 的职责：

- `Trace`：结构化 event 列表，含时间、状态、来源、摘要
- `Artifacts`：diff、文件预览、命令输出、计划草案、报告
- `Resources`：当前 run 依赖的目录、文件、模型、权限、预算
- `Controls`：retry、fork、pause、resume、change scope、reassign

### 4.5 Command Bar

输入区应退化为 command bar，而不是聊天舞台。

它的角色是：

- 新建 task
- 追加约束
- 附加 resource
- 对当前 run 发 intervention
- 执行全局动作

它仍然可以支持自然语言，但视觉上不该再像“主要聊天窗口”。

## 5. 聊天与工作区在新结构中的位置

### 5.1 对话

对话不消失，但只保留为次级 surface。

对话适合承载：

- 给任务补充目标
- 临时追问 agent
- 在 checkpoint 上给出决策
- 追加人工说明

对话不适合继续承载：

- 整个任务历史的主视图
- 唯一的执行追踪界面
- 所有提案与审批的默认容器

### 5.2 工作区

工作区依然重要，但语义需要改变：

- 从“产品主模式”改成“resource”
- 从“是否进入工作区协作”改成“当前 run 使用了哪些资源”

对应到 UI：

- 回形针继续保留
- 回形针的意义是 `Attach Resource`
- 目录、文件、说明文档、URL 都通过同一个入口进入

## 6. 领域对象到页面的投影关系

| 领域对象 | 页面主投影 | 次级投影 |
| --- | --- | --- |
| `workstream` | 左栏 workstream 列表 | 顶栏上下文摘要 |
| `task` | 中间任务板 / 任务列表 | 右侧详情头部 |
| `run` | 主区 active runs / timeline | 右侧 detail |
| `event` | 主区 timeline | 右侧 trace |
| `resource` | 左栏 resource lens | 右侧 resources |
| `artifact` | 右侧 artifacts | 主区里程碑卡片 |
| `checkpoint` | exception inbox / 状态徽标 | 控制面板 |
| `exception` | exception inbox | 顶栏计数 / timeline 标记 |

一个直接原则：

- 聊天文本永远不是顶层对象
- 聊天文本只是一类 event 的文本投影

## 7. 关键交互流

### 7.1 新建任务

1. 用户在 command bar 输入目标
2. 系统创建 task，并挂到当前 workstream
3. agent 进入 planning / running
4. 主区显示 task 卡和活跃 run
5. 右侧 trace 开始累积事件

### 7.2 处理异常

1. 某个 run 进入 blocked / failed / waiting-for-human
2. 左侧 `Exceptions` 和顶栏计数同时提示
3. 用户点开异常，主区聚焦对应 task/run
4. 右侧 `Controls` 提供 retry / fork / intervene / change scope
5. 处理结果继续写回 timeline

### 7.3 追加资源

1. 用户点击回形针或 command bar 的 `Attach Resource`
2. 选择目录、文件、文档或链接
3. 系统把它记录为 resource attach event
4. 该 resource 出现在右侧 `Resources`
5. 后续 run 明确声明是否消费了这些资源

### 7.4 查看产物

1. timeline 中出现 diff ready / report ready / command finished
2. 主区只显示摘要卡
3. 用户点开后在右侧 `Artifacts` 查看完整内容
4. 如需批准，只在 checkpoint 上出现控制按钮

## 8. 当前实现到目标界面的迁移

不建议一次性把所有术语和结构全部推翻，更合理的是按四步迁移。

### 阶段 1：先换主叙事，不急着换底层模型

目标：

- 保留现有 `session / proposal / runtime snapshot`
- 先把页面重心从聊天切到任务流

动作：

- 提升 runtime panel 为主区核心
- 会话列表开始按 task/workstream 语义展示
- `Inspector` 改为 `Run Detail`
- 文件树降级，不再压过任务视图

### 阶段 2：建立任务视图和异常视图

目标：

- 在现有 snapshot 基础上长出真正的 task list / exception inbox

动作：

- 新增任务列表和状态分组
- 新增 blocked / failed / waiting-for-human 聚合
- 让 preview / approval 从消息流中外提到 task/run 视图

### 阶段 3：把工作区收回 resource 维度

目标：

- 去掉“工作区协作是一级主模式”的产品心智

动作：

- attach 入口统一成 `resource attach`
- workspace / file / URL 共用一套 attach 语义
- UI 上弱化“是否绑定工作区”，强化“本 run 使用了哪些资源”

### 阶段 4：让 runtime 成为真相源

目标：

- 前端不再主要读 `messages + proposals`
- 而是读 `task / run / event / artifact / checkpoint`

动作：

- 把 decision deck、preview card、message bubble 都退成 projection
- adapter 层只负责接入 provider
- 主界面只消费 Solo 自己的 runtime projection

## 9. 明确不要再继续做的事

下面这些方向现在应该主动刹车：

- 继续把聊天区做成更像 ChatGPT 的主舞台
- 继续让 `workspace collaboration` 充当一级模式
- 继续把文件树当成左栏第一优先级
- 继续把审批散落在消息流里
- 继续让 runtime 只是侧边角落的一块补充信息

## 10. 对当前仓库的直接要求

如果按这份设计推进，当前实现上最先该动的是：

- [App.jsx](/home/chikee/workspace/solo/src/App.jsx) 的页面分区与主叙事
- [InspectorPane.jsx](/home/chikee/workspace/solo/src/components/InspectorPane.jsx) 的定位和命名
- runtime snapshot 在主区的使用方式
- `workspace`、`proposal`、`message` 这些旧语义在 UI 上的降级方式

一句话收束：

- 先把 `Solo` 做成一个能看清 agent 在做什么、为什么卡住、哪里需要我介入的桌面控制平面
- 再决定聊天区应该占多大位置
