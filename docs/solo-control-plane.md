# Solo 作为 Agent 时代的观测系统

最后更新：2026-04-22

## 1. 一句话定位

`Solo` 不应再被理解为一个 human-in-the-loop 的聊天工作台。

现在更准确的产品定义是：

- `Solo = desktop observability and control plane for agent work`

换成中文：

- `Solo` 是一个面向 agent 时代的任务观测与控制工作台

## 2. 为什么方向会变化

以前做 agent 产品时，一个默认假设是：

- agent 还不够强
- 所以系统需要不断把细节抛回给人确认
- 产品主形态自然会长成“聊天 + 建议 + 预览 + 审批”

但现在这个前提已经在变化：

- agent 能完成的工作越来越完整
- 真正稀缺的不再是“会不会做”
- 而是“怎么管理这些持续在做事的 agent”

也就是说，瓶颈开始从生成能力转向治理能力：

- 任务是否清晰
- 资源是否足够
- 进度是否健康
- 阻塞是否被及时暴露
- 异常是否可以被追溯
- 人应该在什么时候介入

所以 `Solo` 的核心问题不该再是：

- 怎么把 agent 包成一个更顺手的聊天 UI

而应该是：

- 怎么把 agent 的工作过程变成一个可观测、可管理、可控制的系统

## 3. 用户角色的变化

这次重构最关键的判断是：

- 用户不再主要扮演“逐步操作 agent 的人”
- 用户更像产品经理或项目经理

这个角色的职责不是亲自完成每一步，而是：

- 定目标
- 分任务
- 看工期
- 配资源
- 盯状态
- 处理风险
- 在关键点做决策

如果从这个角色出发，用户真正需要的不是“每一步都问我一次”，而是：

- 告诉我现在发生了什么
- 告诉我哪里卡住了
- 告诉我哪些任务偏航了
- 告诉我资源是不是冲突了
- 告诉我什么时候必须由我介入

## 4. PM 视角下，Solo 应该提供什么

从 PM / 项目经理视角出发，`Solo` 至少要成为下面这些能力的承载体：

### 4.1 任务管理

- 当前有哪些任务
- 每个任务的目标、状态、优先级、负责人（agent）
- 哪些任务正在运行，哪些等待，哪些失败，哪些完成

### 4.2 工期管理

- 任务开始时间
- 持续时间
- 延迟与阻塞时长
- 当前节奏是否正常
- 哪些 run 明显超时或停滞

### 4.3 资源协调

这里的资源不只是机器资源，也包括：

- workspace / repo
- model / provider
- tool capability
- permission scope
- token / cost budget
- agent worker 本身

`Solo` 需要让用户看见：

- 哪些任务在争用同一资源
- 哪些任务因为资源不足而阻塞
- 哪些 run 因权限、上下文或预算设置不当而偏航

### 4.4 状态追溯

这是观测系统最核心的价值之一：

- 一个任务为什么会进入当前状态
- 中间发生过哪些 run / event
- 产生过哪些 artifact
- 哪一次 intervention 改变了结果
- 某次失败是否可以复盘、重放、重试或分叉

### 4.5 异常与介入

真正应该让人出现的时机，不是所有微小步骤，而是：

- 里程碑 checkpoint
- 高风险操作
- 计划偏航
- 资源冲突
- 长时间阻塞
- run 失败
- 需要改 scope / 改优先级 / 改负责人

这意味着：

- 人不是默认执行器
- 人是监督者、调度者和最后的升级处理点

## 5. 产品边界

### 应该是

- agent 时代的观测系统
- 桌面优先的本地控制平面
- 面向个人开发者的任务治理工作台
- 以 task / run / event / resource 为主语义的产品
- 可追溯、可回放、可中断、可介入的执行外壳

### 不应该是

- 另一个聊天壳
- 另一个终端包装器
- 另一个伪 IDE
- 默认每一步都让人确认的微操系统
- 只强调“工作区协作”的代码助手

## 6. 核心领域对象

旧方向里 `thread / task / turn / item` 已经是对的开端，但对“观测系统”还不够。

更适合新方向的一组对象应该是：

### 6.1 Workstream

代表一个持续的工作流容器。

它比聊天意义上的 thread 更接近：

- 一条项目脉络
- 一个目标域
- 一个需要长期追踪的工作上下文

### 6.2 Task

代表一个可管理、可排序、可追踪的工作单元。

最小职责：

- 目标
- 优先级
- 当前状态
- 负责人 / agent
- 关联资源
- 预计与实际进度

### 6.3 Run

代表一次实际执行。

它不是一轮聊天，而是一段有开始、有状态迁移、有结果的 agent 工作过程。

最小职责：

- start / finish / duration
- running / blocked / failed / completed
- 使用的资源
- 产出的事件和 artifact
- 与 task 的关系

### 6.4 Event

代表 run 中发生的结构化事件。

包括但不限于：

- plan emitted
- resource attached
- command started
- command failed
- file changed
- artifact generated
- checkpoint reached
- escalation raised
- human intervened

`Solo` 的 UI 最终应该读 event projection，而不是继续读 prompt 产物。

### 6.5 Resource

代表任务推进所依赖或消耗的资源。

包括：

- workspace
- model / provider
- tools
- permission scopes
- budget
- agent worker

### 6.6 Artifact

代表执行产生的可检查结果。

例如：

- diff
- 文件预览
- command output
- 报告
- 计划草案
- review summary

### 6.7 Checkpoint / Exception

代表真正应该把人拉进来的节点。

它不再是“默认每步都审批”，而是：

- checkpoint
- exception
- escalation
- risk review

## 7. UI 应该如何投影这些对象

如果 `Solo` 是观测系统，主界面就不该长期停留在 chat-first。

更合理的投影是：

### 左侧

- workstream 列表
- task 列表
- resource 视图
- 快速筛选与状态聚合

### 中间主区

- 当前 workstream 的任务板
- 活跃 run 列表
- 任务时间线
- 状态转移
- 阻塞和升级事件

### 右侧

- 当前 run 详情
- event trace
- artifact 预览
- resource usage
- intervention history

### 对话区

- 仍然可以存在
- 但更像 secondary surface
- 用来下达目标、补充指令、发起追问、给出人工 intervention
- 不应继续充当产品唯一主舞台

## 8. 对 runtime 的直接要求

这个方向会直接推导出几条 runtime 约束：

1. provider 只能是 adapter，不能定义产品协议
2. runtime 必须拥有 task / run / event / resource 语义
3. UI 只读 runtime projection，不直接消费 provider 原始状态
4. 追溯、重放、恢复、分叉都必须在 runtime 里有正式位置
5. checkpoint / exception 必须是一等运行时对象，不是零散 UI 按钮

## 9. 与当前实现的关系

当前仓库的实现仍然明显属于旧阶段：

- `conversation / workspace collaboration`
- `messages + proposals`
- suggestion + preview + approval

这些现在应被视为过渡资产，而不是最终产品定义。

其中仍然值得保留的部分有：

- Rust 端的 `TaskRecord / TurnRecord / TurnItem` 骨架
- runtime snapshot 能力
- proposal / artifact 的结构化趋势
- 流式事件消费方式

接下来更合理的解释是：

- `turn / item` 可以继续保留，但更适合成为 `run / event` 的下层结构
- `workspace collaboration` 不能再做主产品模式，而应该退回 `resource + capability` 维度
- proposal / approval 应继续收束成 artifact / checkpoint / exception

## 10. 后续执行基线

从这次方向重构开始，`Solo` 的后续实现应优先遵循下面这条路线：

### 第一层

- 先把产品领域模型收成：
  - `workstream`
  - `task`
  - `run`
  - `event`
  - `resource`
  - `artifact`
  - `checkpoint`

### 第二层

- 再把 UI 主轴从消息流切到任务治理与运行观测

### 第三层

- 再把 `codex_cli`、`openai-codex` 和未来其他执行后端统一成 adapter

所以接下来最重要的，不再是：

- 继续把聊天区打磨得更像 ChatGPT
- 继续把逐步审批做得更顺手

而是：

- 让 `Solo` 真正具备 PM 视角下的 agent 任务治理与执行观测能力
