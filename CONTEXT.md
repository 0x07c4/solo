# Solo 上下文与计划

最后更新：2026-04-22

## 1. 当前方向

`Solo` 现在的主方向已经重构为：

- `agent 时代的观测系统`
- 用户更像产品经理 / 项目经理，而不是逐步操作 agent 的执行员
- 产品的核心价值不再是“多聊一点”或“多确认一点”，而是：
  - 管理任务
  - 管理工期与进展
  - 协调资源
  - 追溯状态
  - 在关键节点介入

更直接地说：

- `Solo` 不该继续围绕“对话 + 工作区协作”组织整个产品身份
- 那只是当前 V1 的过渡壳
- 今后的产品主语义应该是：
  - workstream
  - task
  - run
  - event
  - resource
  - artifact
  - checkpoint / exception

## 2. 覆盖性判断

以下判断从现在起优先生效；如果与旧文档、旧 UI 或旧注释冲突，以这里为准。

1. **用户角色改为 PM / 项目经理**
   - 用户主要负责设定目标、管理优先级、观察进度、处理风险和做关键决策。
   - 用户不应默认被放在每个微小步骤的确认链路里。

2. **默认假设 agent 可以连续执行**
   - agent 能力已经足够强，不应再把频繁的人机来回当成默认产品前提。
   - 更合理的交互模式是：
     - agent 持续推进
     - Solo 持续投影状态
     - 人在里程碑、异常、资源冲突、风险上升时介入

3. **`Solo` 应该是观测与控制层，而不是聊天壳**
   - 对话仍然可以存在，但只能作为输入或追问入口之一。
   - 主界面不应再长期以消息流为唯一主轴。

4. **工作区只是资源维度，不再是产品主模式**
   - 工作区、模型、工具、权限、token 预算、运行环境，本质都应被视为资源。
   - “是否使用工作区”不该继续定义整个产品交互模型。
   - 资源访问不应默认要求用户预先添加目录；更合理的是 agent 在需要文件、目录、URL 或权限时提出资源请求，用户在 checkpoint 上授权。

5. **审批从“默认每步确认”改为“检查点 / 异常处理”**
   - 审批仍然重要，但不应继续做成所有工作默认都要过的人肉阀门。
   - 更合理的是：
     - checkpoint
     - escalation
     - exception
     - rollback / retry / reassign

6. **产品第一性问题改为任务治理，而不是回复体验**
   - 优先级更高的问题是：
     - 当前有哪些任务
     - 哪些任务正在推进
     - 哪些任务阻塞
     - 哪些资源冲突
     - 哪些 run 失败或偏航
     - 哪些 artifact 已产出
   - 不再把“让回复更像 ChatGPT”视作主方向。

7. **界面应该少解释，多投影状态**
   - 好的 UI 应该让用户一眼看出当前能做什么、哪里阻塞、哪里需要介入。
   - 不应依赖大段说明文字解释功能。
   - 文案只保留状态、对象名、动作和必要错误；长解释应进入详情、文档或 hover/title。

8. **运行时模型要为观测系统服务**
   - 当前 `thread / task / turn / item` 的工作仍然有价值，但应继续外扩到更适合观测系统的对象：
     - `workstream`
     - `task`
     - `run`
     - `event`
     - `resource`
     - `artifact`
     - `checkpoint`
   - UI 以后应优先读这些对象的 projection，而不是继续围绕 `message/proposal` 做产品设计。

## 3. 当前实现快照

当前仓库仍然明显处在旧壳向新方向迁移的过渡阶段。

现在已经有的可复用基础：

- React + Tauri 的桌面形态
- 本地持久化的 sessions / workspaces / settings
- `codex_cli` 驱动的执行链路
- 流式状态、阶段摘要和右侧 runtime snapshot
- Rust 端最小 `TaskRecord / TurnRecord / TurnItem` 持久化骨架
- proposal / approval 流程和基础事件总线

这些资产依然有用，但应被重新解释为：

- 它们不是“聊天工作台”的完成度
- 而是“观测系统底座”的早期实现

当前最大的偏差：

- 主 UI 仍以消息流为主
- 工作区协作仍然是强产品主语义
- 批准 / 拒绝仍更像逐步确认流
- `task` 还没有成为真正的一等治理对象
- 资源、工期、阻塞、异常追溯都还没有正式进入产品域

## 4. 近期计划

后续计划从现在起按这个方向执行。

### P0

- 定义新的产品领域模型：
  - `Workstream`
  - `Task`
  - `Run`
  - `Event`
  - `Resource`
  - `Artifact`
  - `Checkpoint`
- 明确这些对象和当前 `session / task / turn / item / proposal` 的映射关系。
- 把“审批”从通用微确认，重构为 checkpoint / exception 体系。
- 增加外部 agent 观测能力：
  - 发现用户已经在其他终端启动的 `codex` 进程
  - 按 `cwd` 关联 workspace / resource
  - 第一版只做 `observe-only`，不把外部进程误认为 Solo 可控制的 managed run

### P1

- 把主界面从 chat-first 改成 observability-first：
  - 任务面板
  - 活跃 run 列表
  - 时间线 / 事件流
  - 阻塞与异常面板
  - artifact / diff / output 检视面板
- 让聊天区降级为次级输入面，而不是产品中心。

### P2

- 引入资源视角：
  - workspace
  - provider / model
  - tools
  - permission scope
  - token / cost / runtime budget
- 支持从“任务推进”而不是“消息轮次”来观察资源消耗与争用。

### P3

- 引入工期与节奏视角：
  - 预计开始 / 完成
  - 当前延迟
  - blocked duration
  - escalation age
  - intervention history
- 让 `Solo` 能真正承担项目管理视角下的 agent 监督工作。

### P4

- 统一 headless runtime 与 provider adapter：
  - `codex_cli`
  - `openai-codex`
  - 后续其他 agent runtime
- 要求所有 adapter 产出同一套 run/event/resource/checkpoint 语义。

## 5. 当前执行基线

从现在开始：

- 文档、设计和实现优先围绕“观测系统”推进
- 如果出现“继续围绕聊天 UI 打磨体验”和“推进任务治理 / 状态追溯 / 资源协调”之间的冲突，后者优先
- 如果旧文档里仍然保留 `human-in-the-loop chat workbench` 的表达，应视为历史阶段判断，而不是当前方向
