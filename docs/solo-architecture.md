# Solo 架构图总览

最后更新：2026-03-30

适用范围：

- 这份文档描述的是当前仓库实现出来的 `Solo`
- 图里会明确区分：
  - 当前已实现结构
  - 已经在代码里出现的过渡结构
  - 后续建议目标

相关文件：

- 产品与 runtime 重心：[solo-control-plane.md](./solo-control-plane.md)
- 主界面设计：[solo-surface-design.md](./solo-surface-design.md)
- 前端：[App.jsx](/home/chikee/workspace/solo/src/App.jsx)
- IPC 入口：[desktop.js](/home/chikee/workspace/solo/src/api/desktop.js)
- Tauri runtime：[lib.rs](/home/chikee/workspace/solo/src-tauri/src/lib.rs)
- 数据模型：[models.rs](/home/chikee/workspace/solo/src-tauri/src/models.rs)
- 持久化与工作区：[storage.rs](/home/chikee/workspace/solo/src-tauri/src/storage.rs)
- OpenAI 通道：[openai.rs](/home/chikee/workspace/solo/src-tauri/src/openai.rs)

## 1. 系统上下文

```mermaid
flowchart LR
    U["用户"]
    APP["Solo Desktop App\nReact + Tauri"]
    FS["本地文件系统\nworkspace / .ignore / files"]
    CLI["Codex CLI\ncodex login / codex exec"]
    API["OpenAI-Compatible API\nchat/completions"]
    CHATGPT["浏览器中的 ChatGPT 登录流程"]
    DATA["本地应用数据目录\nsettings.json\nsessions.json\nworkspaces.json\napprovals.json"]

    U --> APP
    APP --> FS
    APP --> DATA
    APP --> CLI
    APP --> API
    APP --> CHATGPT
```

当前判断：

- `Solo` 是本地桌面工作台，不是浏览器 SaaS。
- 工作区、会话、审批、预览都以本地状态为主。
- `codex_cli` 和 `openai` 都只是接入通道，不应定义产品主语义。

## 2. 代码模块总览

```mermaid
flowchart LR
    subgraph FE["前端 / src"]
        MAIN["main.jsx"]
        APP["App.jsx"]
        APIJS["api/desktop.js"]
        MODALS["SettingsModal / WorkspaceModal / ManualImportModal"]
        LEGACY["Sidebar / InspectorPane / ChatPane\n历史拆分组件，当前主页面已内联收口到 App.jsx"]
    end

    subgraph BE["后端 / src-tauri/src"]
        LIB["lib.rs"]
        MODELS["models.rs"]
        STORE["storage.rs"]
        OPENAI["openai.rs"]
    end

    MAIN --> APP
    APP --> APIJS
    APP --> MODALS
    APP --> LEGACY
    APIJS --> LIB
    LIB --> MODELS
    LIB --> STORE
    LIB --> OPENAI
```

当前结构特征：

- 前端状态机高度集中在 [App.jsx](/home/chikee/workspace/solo/src/App.jsx)。
- Rust 端也高度集中在 [lib.rs](/home/chikee/workspace/solo/src-tauri/src/lib.rs)。
- 模块边界已经有雏形，但还没进一步拆成更清晰的 service/runtime layer。

## 3. 前端架构

```mermaid
flowchart TD
    APP["App.jsx\n主状态容器"]
    TOP["Topbar\n状态、主题、网络、窗口控制"]
    LEFT["Sidebar\n会话 / 工作区 / 文件树"]
    CENTER["Chat Pane\n消息流 + Decision Deck + Preview Cards + Composer"]
    RIGHT["Inspector\n上下文 / 建议状态 / 文件预览"]
    SETTINGS["SettingsModal"]
    WORKSPACE["WorkspaceModal"]
    MANUAL["ManualImportModal"]

    APP --> TOP
    APP --> LEFT
    APP --> CENTER
    APP --> RIGHT
    APP --> SETTINGS
    APP --> WORKSPACE
    APP --> MANUAL
```

说明：

- 当前主页面已经不是“多个大组件各自持有复杂状态”，而是 `App.jsx` 统一持状态，再把局部 UI 作为片段或轻组件渲染。
- 这是当前实现最真实的前端架构，不是理想化分层。

## 4. 前端状态与派生关系

```mermaid
flowchart LR
    S1["sessions"]
    S2["workspaces"]
    S3["workspaceTree / filePreview"]
    S4["proposalsBySession"]
    S5["streamProgressBySession"]
    S6["streamMonitorBySession"]
    S7["turnIntentBySession"]
    S8["decisionPreviewBySession"]
    S9["settings / codexAuth / theme"]

    D1["activeSession"]
    D2["activeWorkspace"]
    D3["activeProposals"]
    D4["activeDecisionSet"]
    D5["decisionOptions / selectedDecisionOption / previewProposals"]

    S1 --> D1
    S2 --> D2
    S4 --> D3
    D1 --> D4
    D3 --> D4
    S7 --> D4
    S8 --> D4
    D4 --> D5
    S3 --> RIGHTVIEW["文件预览投影"]
    S5 --> STREAMVIEW["消息进度投影"]
    S9 --> TOPVIEW["顶栏与设置投影"]
```

核心点：

- 当前前端的“领域投影”主要体现在 `DecisionSet`。
- `DecisionSet` 不是后端真模型，而是前端从 `proposal` 集合投影出来的过渡层。
- 这也是当前最明显的过渡性：产品已经开始按决策域表达，底层仍是 `messages + proposals`。

## 5. 前端事件监听架构

```mermaid
flowchart TD
    EVT["Tauri Event Bus"]
    STATUS["chat-stream-status"]
    TOKEN["chat-stream-token"]
    DONE["chat-stream-done"]
    CREATED["tool-proposal-created"]
    UPDATED["approval-updated"]
    CMDOUT["command-output"]
    CMDDONE["command-finished"]

    EVT --> STATUS
    EVT --> TOKEN
    EVT --> DONE
    EVT --> CREATED
    EVT --> UPDATED
    EVT --> CMDOUT
    EVT --> CMDDONE

    STATUS --> P1["更新 streamProgress / streamMonitor"]
    TOKEN --> P2["patch assistant message streaming 内容"]
    DONE --> P3["收口消息状态 + 停止 loading"]
    CREATED --> P4["upsert proposal"]
    UPDATED --> P5["同步 proposal 状态"]
    CMDOUT --> P6["追加命令输出"]
    CMDDONE --> P7["命令结束提示"]
```

这个事件层很关键：

- 前端不是被动等一个最终回复对象。
- 它在消费一条运行时事件流。
- 这也是后续做 `replay provider`、`turn/item` 的最好切入点。

## 6. IPC / Tauri Commands 边界

```mermaid
flowchart LR
    FE["前端 invoke/listen"]
    IPC["Tauri Commands"]

    FE --> IPC

    IPC --> C1["settings_get / settings_update / settings_test_connection"]
    IPC --> C2["sessions_list / session_create / session_open / session_delete / session_mode_set"]
    IPC --> C3["workspaces_list / workspace_add / workspace_remove / workspace_select"]
    IPC --> C4["workspace_tree / workspace_read_file"]
    IPC --> C5["chat_send / manual_import_assistant_reply"]
    IPC --> C6["approval_list / proposal_choose / approval_accept / approval_reject"]
```

这层职责很清楚：

- 前端只能通过 command 访问系统能力。
- 读写工作区、跑命令、登录检测、模型请求都不直接暴露给前端。

## 7. 会话与回合执行主流程

```mermaid
flowchart TD
    SEND["chat_send"]
    SESSION["更新 session\n写入 user message\n归档旧 pending proposal"]
    MODE["确定 interaction_mode\nConversation / WorkspaceCollaboration"]
    PROVIDER["确定 effective_provider\ncodex_cli / openai / manual"]
    SPAWN["spawn async turn task"]
    TURN["process_chat_turn"]
    DONE["persist assistant message\nemit done event"]

    SEND --> SESSION --> MODE --> PROVIDER --> SPAWN --> TURN --> DONE
```

这个流程的几个关键现实：

- `chat_send` 先写本地 session，再异步跑模型。
- `manual` provider 在 `chat_send` 后就直接返回，不会自动跑模型。
- `openai` provider 会在有本机 Codex 登录态时被折返为 `codex_cli`。

## 8. Provider 架构

```mermaid
flowchart LR
    TURN["process_chat_turn"]

    TURN --> MANUAL["manual\n只记录问题，不自动出回复"]
    TURN --> CODEX["codex_cli\ncodex exec --json"]
    TURN --> OPENAI["openai\nchat/completions + tools"]

    CODEX --> CODEXFLOW["流式 stdout/stderr\n状态归一化\n提案块解析"]
    OPENAI --> OAIFLOW["function tool loop\nlist_files / read_file /\npropose_write_file / propose_run_command"]
```

当前 provider 差异：

- `manual`：最轻，只记消息，回复由用户手动导入。
- `codex_cli`：最重，但最贴近当前工作区协作产品体验。
- `openai`：真实 API 通道，但当前更像兼容入口，不是主路线。

## 9. Codex CLI 流式执行链路

```mermaid
flowchart TD
    TURN["process_chat_turn"]
    PROMPT["build_codex_exec_prompt"]
    EXEC["codex exec --json --output-last-message"]
    STDOUT["stdout reader"]
    STDERR["stderr reader"]
    NORMAL["状态归一化\nextract_codex_status / delta"]
    WATCH["超时 / 空闲 / 重连监控"]
    FILE["读取 output_last_message 文件"]
    PARSE["parse solo-choice / solo-write / solo-command"]
    EMIT["emit token/status/proposal events"]

    TURN --> PROMPT --> EXEC
    EXEC --> STDOUT --> NORMAL
    EXEC --> STDERR --> NORMAL
    NORMAL --> EMIT
    EXEC --> WATCH
    EXEC --> FILE --> PARSE --> EMIT
```

这里体现了当前 `Solo` 的一个重要现实：

- `codex_cli` 不是简单“拿一段最终文本”。
- 它已经被包装成一条带进度、提案解析、重连监控的 runtime adapter。

## 10. OpenAI Provider 工具调用链路

```mermaid
flowchart TD
    TURN["process_chat_turn"]
    MSGS["CompletionMessage[]"]
    API["chat_completion"]
    TOOL["tool_calls"]
    HANDLER["handle_tool_call"]
    WLIST["list_files"]
    WREAD["read_file"]
    PWRITE["create_write_proposal"]
    PCMD["create_command_proposal"]
    LOOP["最多 6 轮工具循环"]

    TURN --> MSGS --> API
    API --> TOOL
    TOOL --> HANDLER
    HANDLER --> WLIST
    HANDLER --> WREAD
    HANDLER --> PWRITE
    HANDLER --> PCMD
    HANDLER --> LOOP
    LOOP --> API
```

说明：

- `openai` 这条链不解析 `solo-*` 代码块。
- 它走的是 function tools。
- 所以当前两个 provider 的“提案生成协议”其实是不一致的。

这也是后续需要继续收敛 runtime 协议的原因。

## 11. Proposal / Approval 领域流

```mermaid
flowchart LR
    GEN["提案生成"]
    TYPES["choice / write / command"]
    STORE["store.proposals"]
    PENDING["status = pending"]
    SELECT["proposal_choose\nchoice -> selected"]
    ACCEPT["approval_accept"]
    REJECT["approval_reject"]
    APPLY["write apply / command run / choice applied"]
    FAIL["failed"]

    GEN --> TYPES --> STORE --> PENDING
    PENDING --> SELECT
    PENDING --> ACCEPT
    PENDING --> REJECT
    ACCEPT --> APPLY
    ACCEPT --> FAIL
    SELECT --> APPLY
```

当前状态机并不完全统一：

- `choice`：`pending -> selected -> 后续一轮 preview`
- `write`：`pending -> applied`
- `command`：`pending -> approved -> applied/failed`

所以它已经有审批语义，但还不是一套整齐的 turn/item 状态机。

## 12. 决策流投影架构

```mermaid
flowchart TD
    PROPS["raw proposals"]
    CHOICE["choice proposals"]
    APPROVAL["write / command proposals"]
    OPTION["buildDecisionOption"]
    CARD["buildApprovalCard"]
    DSET["buildDecisionSet"]
    MAIN["主区\nDecision Deck / Selected Banner / Preview Cards"]
    SIDE["右侧 Inspector\n阶段摘要 / 上下文 / 文件预览"]

    PROPS --> CHOICE --> OPTION
    PROPS --> APPROVAL --> CARD
    OPTION --> DSET
    CARD --> DSET
    DSET --> MAIN
    DSET --> SIDE
```

这张图代表当前最重要的产品表达：

- 原始 `proposal` 不再直接等于主区 UI。
- 主区主要读 `DecisionSet` 投影。
- 右侧已经降级为上下文和状态摘要，不再承担主决策面。

## 13. 工作区与文件系统架构

```mermaid
flowchart TD
    WS["Workspace\nid / name / path / recent_files"]
    TREE["build_workspace_tree"]
    IGN["read_workspace_ignore_patterns\n.ignore"]
    READ["read_workspace_file"]
    PREV["preview_file_result"]
    RESOLVE["resolve_workspace_file"]
    DIFF["diff_text"]
    APPLY["apply_write_proposal"]

    WS --> IGN
    WS --> TREE
    WS --> READ
    WS --> RESOLVE
    READ --> PREV
    RESOLVE --> DIFF
    RESOLVE --> APPLY
    IGN --> TREE
    IGN --> READ
    IGN --> APPLY
```

这里的边界是清楚的：

- `.ignore` 已经不只是 UI 过滤，而是进入读取和写入链路。
- 写文件不是直接执行，而是先生成带 `base_hash` 的 proposal，再应用。

## 14. 本地持久化架构

```mermaid
flowchart LR
    STORE["Store"]
    SETTINGS["settings.json"]
    SESSIONS["sessions.json"]
    WORKSPACES["workspaces.json"]
    APPROVALS["approvals.json"]

    STORE --> SETTINGS
    STORE --> SESSIONS
    STORE --> WORKSPACES
    STORE --> APPROVALS
```

当前事实：

- 本地真相是四个 JSON 文件。
- 没有数据库。
- `Store` 通过 `Mutex` 串行访问。

优点是简单，缺点是：

- 状态模型现在还比较扁平。
- 一旦 turn/item 真正落地，持久化结构大概率也要升级。

## 15. 命令执行链路

```mermaid
flowchart TD
    APPROVE["approval_accept(command)"]
    STATUS["proposal.status = approved"]
    RUN["run_command_proposal"]
    SPAWN["spawn child process"]
    STREAM["stdout/stderr -> command-output"]
    FINISH["exit code -> command-finished"]
    UPDATE["proposal.status = applied / failed"]

    APPROVE --> STATUS --> RUN --> SPAWN --> STREAM --> FINISH --> UPDATE
```

特点：

- 命令 proposal 不会在确认前执行。
- 命令输出是单独事件流，不复用聊天 token 流。

## 16. 手动导入链路

```mermaid
flowchart LR
    USER["用户从外部拿回复"]
    MODAL["ManualImportModal"]
    CMD["manual_import_assistant_reply"]
    PARSE["parse solo-write / solo-command / solo-choice"]
    STORE["写入 assistant message + proposals"]
    EMIT["emit tool-proposal-created"]

    USER --> MODAL --> CMD --> PARSE --> STORE --> EMIT
```

这条链路的价值不是“假数据”，而是：

- 它已经证明 `Solo` 可以把“回复来源”和“前端体验”解耦。
- 后续无论做 `replay provider` 还是更多 provider，都会复用这类解耦思路。

## 17. 当前真实架构边界

```mermaid
flowchart LR
    PROVIDER["provider adapter\ncodex_cli / openai / manual"]
    RUNTIME["当前 runtime 真相\nmessages + proposals + events"]
    PROJECTION["前端 projection\nDecisionSet / Preview Cards / Inspector"]
    UI["产品表达\n对话 / 工作区协作 / 建议 / 预览 / 确认"]

    PROVIDER --> RUNTIME --> PROJECTION --> UI
```

当前最重要的判断：

- `UI` 已经开始按产品语义组织。
- `PROJECTION` 已经出现。
- 真正还没升级的是 `RUNTIME`，它还没有正式收敛为 `session -> turn -> item`。

## 18. 目标架构

```mermaid
flowchart TD
    SESSION["Session / Thread"]
    TURN["Turn"]
    ITEM["Turn Items\nuserMessage / agentMessage / choice / fileChange / commandExecution / approval"]
    APPROVAL["Approval State"]
    PROJECTION["Projection Layer\nDecisionSet / ApprovalCard / Chat Timeline / Inspector Summary"]
    PROVIDER["Provider Adapters\ncodex_cli / openai / manual / replay / future app server"]
    UI["UI"]

    PROVIDER --> ITEM
    SESSION --> TURN --> ITEM
    ITEM --> APPROVAL
    ITEM --> PROJECTION --> UI
```

这不是“已经实现”的图，而是现在最合理的收敛目标。

和当前实现相比，差别在于：

- 当前：`messages + proposals` 还是底层真相
- 目标：`turn + item + approval` 才是底层真相
- 当前：DecisionSet 是前端投影
- 目标：DecisionSet 应该从统一 item/projection 层投出来

## 19. Replay Provider 在全局架构中的位置

```mermaid
flowchart LR
    PROVIDERS["Provider Adapters"]
    CODEX["codex_cli"]
    OPENAI["openai"]
    MANUAL["manual"]
    REPLAY["replay"]
    RUNTIME["Solo Runtime"]
    UI["现有 UI 与事件监听"]

    PROVIDERS --> CODEX
    PROVIDERS --> OPENAI
    PROVIDERS --> MANUAL
    PROVIDERS --> REPLAY

    CODEX --> RUNTIME
    OPENAI --> RUNTIME
    MANUAL --> RUNTIME
    REPLAY --> RUNTIME
    RUNTIME --> UI
```

这块是补充说明：

- `replay` 应该只是 provider adapter，不应该自带第二套 UI。
- 它应该复用现有事件协议和 proposal/store 更新路径。

更细的 `replay` 设计见 [replay-provider-architecture.md](/home/chikee/workspace/solo/docs/replay-provider-architecture.md)。

## 20. 我对当前架构的直接结论

### 做对了的部分

- 产品模式已经明确：`对话 / 工作区协作` 是显式状态。
- 主区已经开始从“长消息”转向“决策流”。
- `.ignore` 已经进入真实协作边界，而不只是 UI 装饰。
- provider、存储、文件系统、事件流已经有初步边界。

### 当前最大的问题

- 前端和 Rust 端的主状态机都还过于集中在单文件。
- `codex_cli` 和 `openai` 的提案协议还不统一。
- `messages + proposals` 仍是底层真相，DecisionSet 还只是投影层补救。
- 审批流已经有了，但还不是统一 item 状态机。

### 最值得继续推进的方向

1. 继续把 `DecisionSet` 从前端投影推进到更稳定的 runtime projection。
2. 让 provider 输出统一进入一套 item/projection 协议，而不是各走各的解析方式。
3. 把 `App.jsx` 和 `lib.rs` 继续拆薄，但前提是先明确 runtime 边界，不是机械拆文件。
