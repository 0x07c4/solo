# Task → Run → Event 绑定闭环

最后更新：2026-05-05 | 状态：**✅ 全部完成**

## 1. 背景

后端 `TaskRecord`、`TurnRecord`、`TurnItem` 三种领域结构已完整定义，且执行链路 `chat_send` → `process_chat_turn` 已完全接入 Task/Turn/Item 持久化。Rust 侧 `#[allow(dead_code)]` 注解已移除（2026-05-05），`session_runtime_snapshot` 命令完整回传 task/turn/item 树，前端 `activeRuntimeItems` 直接消费真实 TurnItem 数据。

本章档记录 8 个任务的实际实现位置和调用链路，方便后续维护和扩展。

## 2. 闭环定义

```
创建 Task → 启动 Run (Turn) → Run 过程中产生 Event (TurnItem)
                                  ↓
  用户发新消息 → 新 Run → 新 Event →  Task 状态随 Run 结果更新
                                  ↓
  异常/审批 → TurnItem 状态变更 →  Run 阻塞/恢复 → Task 状态联动
```

## 3. 数据模型速览

见 `src-tauri/src/models.rs`：

- `TaskRecord` — 6 种状态：Active / Blocked / WaitingUser / Completed / Failed / Cancelled
- `TurnRecord` — 5 种状态：Pending / Running / Completed / Failed / Cancelled；3 种 intent：Auto / Choice / Preview
- `TurnItem` — 11 种 kind：UserMessage / AgentMessage / Plan / StatusUpdate / Choice / ConceptPreview / FileChangePreview / CommandPreview / ApprovalRequest / CommandOutput / CommandResult；6 种 approval_state

## 4. 任务列表

### 任务 1：`chat_send` 入口创建 TurnRecord ✅

**实现位置**：
- `chat_send` 第 1402-1414 行调用 `start_turn_for_session`
- `start_turn_for_session` 第 4573-4620 行：创建 `TurnRecord`（status=Running），调用 `ensure_active_task_for_session` 关联 Task，更新 `task.current_turn_id` / `latest_turn_id`

---

### 任务 2：写入 UserMessage TurnItem ✅

**实现位置**：`start_turn_for_session` 第 4605-4617 行，通过 `append_turn_item` 创建 kind=`UserMessage` 的 TurnItem

---

### 任务 3：`process_chat_turn` 写入 AgentMessage TurnItem ✅

**实现位置**：
- `persist_assistant_message` 第 4165-4197 行 → 调用 `attach_assistant_message_to_current_turn`
- `attach_assistant_message_to_current_turn` 第 4622-4679 行：创建 kind=`AgentMessage` 的 TurnItem，同时更新 TurnRecord 状态（Completed/Failed）和 TaskRecord 状态（WaitingUser/Failed）

---

### 任务 4：proposal 创建时间步生成 TurnItem ✅

**实现位置**：
- `attach_proposal_item_to_current_turn` 第 4681-4748 行：按 proposal kind 映射到 TurnItemKind（Write→FileChangePreview, Command→CommandPreview, Choice→Choice）
- 调用点（6 处）：`create_write_proposal`(3892), `create_command_proposal`(3952), `create_reply_proposals`(4880), `create_manual_proposal`(5295,5335,5364)

---

### 任务 5：proposal 审批后更新 TurnItem 状态 ✅

**实现位置**：
- `sync_turn_item_with_proposal` 第 4303-4348 行：根据 proposal.status 映射 TurnItem 的 approval_state / status
- 调用点：`chat_send`(1351), `approval_accept`(1772), `approval_reject`(1880), `create_manual_proposal`(5317) 等多处

---

### 任务 6：Turn 完成时更新 TurnRecord 和 TaskRecord ✅

**实现位置**：`attach_assistant_message_to_current_turn` 第 4622-4679 行
- TurnRecord.status → Completed（或 error 时 Failed）（第 4635-4643 行）
- TaskRecord.status → WaitingUser（或 error 时 Failed），current_turn_id → None（第 4663-4676 行）

---

### 任务 7：关键阶段创建 StatusUpdate TurnItem ✅

**实现位置**：
- `upsert_codex_turn_status_item_into_store` 第 4460-4571 行：按 stage 去重 upsert，Terminal 状态时更新 TurnRecord status
- 调用点：`upsert_codex_turn_status_update`(4437) → 在 `run_codex_chat_turn_streaming` 中的多个 emit `chat-stream-status` 位置触发

---

### 任务 8：前端 Timeline 消费 TurnItem ✅

**实现位置**：`src/App.jsx`
- `activeRuntimeItems` 第 3232-3239 行：从 `session_runtime_snapshot` 返回的 `turnItems` 按 `turnId` 过滤
- `sessionRuntimeSummaries` 第 3240-3299 行：按 turnItem 的 approval_state / status 派生状态色和分组
- mock 数据路径已完全清除（`mockProposal` / `mockTimelineItems` / `getMockAffectedFiles` 等已在之前的迭代中移除）

---

## 5. 依赖关系（全部已打通）

```
✅ 任务1 (start_turn_for_session) → 创建 TurnRecord
  ├── ✅ 任务2 (append_turn_item) → UserMessage TurnItem（同在 start_turn_for_session 内）
  └── ✅ 任务3 (attach_assistant_message_to_current_turn) → AgentMessage TurnItem
        ├── ✅ 任务4 (attach_proposal_item_to_current_turn) → proposal → TurnItem 映射
        ├── ✅ 任务5 (sync_turn_item_with_proposal) → 审批后 TurnItem 状态同步
        └── ✅ 任务7 (upsert_codex_turn_status_item_into_store) → StatusUpdate TurnItem
              └── ✅ 任务6 (attach_assistant_message_to_current_turn) → Turn/Task 完成联动
✅ 任务8 (App.jsx activeRuntimeItems) → 前端消费真实 TurnItem 数据
```

## 6. 调用链路总览

```
chat_send (line 1299)
  ├── state.update (line 1315)  → 写 session.messages + archive旧proposals + sync_turn_item_with_proposal
  ├── start_turn_for_session (line 1403) → 创建 TurnRecord + UserMessage TurnItem + 更新 TaskRecord
  ├── spawn process_chat_turn (line 1425)
  │     ├── run_codex_chat_turn_streaming → upsert_codex_turn_status_update (多次)
  │     ├── create_reply_proposals → attach_proposal_item_to_current_turn
  │     ├── persist_assistant_message → attach_assistant_message_to_current_turn (完成 Turn + 更新 Task)
  │     └── emit chat-stream-done
  └── approval_accept/reject → sync_turn_item_with_proposal

前端轮询 (1.2s interval):
  session_runtime_snapshot → App.jsx activeRuntimeItems → timeline 渲染
```

## 7. 关键函数索引

| 函数 | 行号 | 职责 |
|------|------|------|
| `start_turn_for_session` | 4573 | 创建 TurnRecord + UserMessage TurnItem |
| `ensure_active_task_for_session` | 4199 | 获取或创建 active TaskRecord |
| `append_turn_item` | 4350 | 通用 TurnItem 创建器 |
| `attach_assistant_message_to_current_turn` | 4622 | AgentMessage TurnItem + Turn/Task 完成联动 |
| `attach_proposal_item_to_current_turn` | 4681 | proposal → TurnItem 映射 |
| `sync_turn_item_with_proposal` | 4303 | proposal 状态 → TurnItem 状态同步 |
| `upsert_codex_turn_status_item_into_store` | 4460 | StatusUpdate TurnItem（去重 upsert） |
| `current_turn_index_for_session` | 4252 | 查找 session 的当前 Running/Pending turn |
| `attachable_turn_index_for_session` | 4272 | 查找可附加消息的 turn |
| `persist_assistant_message` | 4165 | 写入 session.messages + 触发 Turn 完成 |
| `session_runtime_snapshot` (Rust) | 1086 | 命令入口，回传 task/turn/item 树 |
| `activeRuntimeItems` (JS) | 3232 | 前端按 turnId 过滤 turnItems |

## 8. 当前状态

`#[allow(dead_code)]` 注解已于 2026-05-05 从 `storage.rs` 的 `tasks`/`turns`/`turn_items` 字段及 `save_tasks()`/`save_turns()`/`save_turn_items()` 方法移除。`sorted_tasks`/`sorted_turns`/`sorted_turn_items` 辅助方法保留 dead_code 注解（未被外部调用，仅作备用查询入口）。

Task → Run → Event 绑定闭环的 8 个任务全部完成。后端从 `chat_send` 入口到 `chat-stream-done` 出口，全链路写入 TaskRecord / TurnRecord / TurnItem。前端 `session_runtime_snapshot` 回传完整数据，`activeRuntimeItems` 直接消费渲染。
