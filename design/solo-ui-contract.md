# Solo UI Contract

Last updated: 2026-04-25

This contract translates `solo-ui-overview-v2.op` into implementation rules.

It is not a visual spec. It defines what each region means, which existing state may feed it, and what must not be implemented in the first pass.

See `design/solo-observability-model.md` for the ownership, observation-level, and control-boundary rules that gate runtime work. This UI contract must not imply stronger control than that model allows.

## 1. Implementation boundary

First pass scope:

| Area | Rule |
| --- | --- |
| Runtime | Do not change Tauri commands, desktop API contracts, event names, or backend data models. |
| State | Reuse existing `App.jsx` state first. Add only local projection helpers if needed. |
| Layout | Implement the shell and information hierarchy, not pixel-perfect OpenPencil reproduction. |
| Theme | Introduce token aliases and tone classes before adding component-specific colors. |
| Inspector | Start with checkpoint-focused inspector only. Do not build full entity routing yet. |
| Timeline | Show a curated event projection, not raw provider logs. |
| Outputs | Show artifacts only. Do not mix resources, file tree nodes, or runtime events into outputs. |
| External Codex supervision | Treat discovered external Codex processes as observe-only evidence/resources. Do not promote them into managed workstreams or rewrite the main task IA. |

Do not use this pass to solve:

| Deferred | Reason |
| --- | --- |
| Full runtime model migration | Too large and would mix product architecture with visual landing. |
| Multi-run branching | Needs separate task/run model work. |
| Full artifact gallery | The v2 output tray is intentionally shallow. |
| Inspector multi-object routing | Requires a selected object model that should be staged. |
| OpenPencil-to-code pixel matching | The design artifact is directional, not a production layout source. |
| External Codex takeover | Supervising an existing process is not the same as controlling or converting it. |

## 2. Regions

The app shell is divided into eight regions.

```text
TopStatusBar
WorkstreamRail
CurrentTask
ActiveRun
Timeline
Outputs
Inspector
CommandBar
```

### 2.1 TopStatusBar

Purpose:

| Responsibility | Notes |
| --- | --- |
| Workspace identity | Project, path, branch or equivalent identity. |
| Control boundary | Codex login, managed mode, observe-only mode. |

Allowed content:

| Content | Source |
| --- | --- |
| App identity | Static app shell text. |
| Current workspace path/name | `activeWorkspace`, `activeSessionWorkspaceId`. |
| Auth state | `codexAuth`, `settings.provider`. |
| Control boundary badges | Derived from session/runtime/resource state. |

Do not include:

| Avoid | Reason |
| --- | --- |
| `1 blocked / 2 approvals / 1 external` repeated chips | These duplicate left rail, inspector, and command bar. |
| Current task status | Belongs in `CurrentTask`. |
| Checkpoint action buttons | Belong in `CommandBar` or checkpoint inspector. |

### 2.2 WorkstreamRail

Purpose:

| Responsibility | Notes |
| --- | --- |
| Workstream navigation | List active, waiting, and done workstreams or sessions. |
| Exception inventory | Compact list of blocked incidents. |
| Resource inventory | Workspaces, attached resources, external Codex resources. |

External Codex rule:

| Rule | Reason |
| --- | --- |
| External Codex appears under `Resources`, not as a workstream lane. | It is observe-only evidence unless Solo created or explicitly adopted the run. |
| Workstream cards remain managed Solo sessions/tasks. | Prevents process discovery from changing the product information architecture. |
| Codex processes spawned by Solo are not counted as external. | Prevents managed runs from being double-counted as observe-only resources and prevents silent takeover. |

Allowed card fields:

| Field | Rule |
| --- | --- |
| `title` | One line; truncate if long. |
| `mode` | `managed`, `observe-only`, `resource-attached`, or equivalent. |
| `health` | One compact status only. |
| `count` | At most one important count. |

Do not include by default:

| Avoid | Destination |
| --- | --- |
| Long paths | Inspector or tooltip. |
| PID / command line | Resource inspector. |
| Multiple counters per card | Inspector or detail view. |

### 2.3 CurrentTask

Purpose:

| Responsibility | Notes |
| --- | --- |
| Show the currently governed task | This is the center's primary title. |
| Separate workstream from task | Workstream is context; current task is the main object. |
| Show short status strip | Run, next action, output count. |

Fields:

| Field | Example | Source |
| --- | --- | --- |
| `taskTitle` | `OpenPencil overview v2` | Current session/task/projection. |
| `workstreamLabel` | `Workstream: Solo UI redesign` | Current session/workstream projection. |
| `taskState` | `waiting approval` | Derived from checkpoint/proposal/runtime state. |
| `runState` | `active` | Runtime snapshot/stream monitor. |
| `nextIntent` | `approve` | Current checkpoint/proposal state. |
| `outputCount` | `3 +1` | Artifact projection. |

Do not include long explanatory copy.

### 2.4 ActiveRun

Purpose:

| Responsibility | Notes |
| --- | --- |
| Show the live run summary | One active run summary at a time. |
| Show control ownership | `managed` vs `observe-only`. |
| Provide entry into timeline | Summary sits above timeline rows. |

Fields:

| Field | Example |
| --- | --- |
| `source` | `managed Codex`, `external Codex`. |
| `summary` | `Generating editable overview artifact`. |
| `next` | `approve direction`. |
| `capability` | See capability matrix. |

Do not show raw stdout or provider logs here.

### 2.5 Timeline

Purpose:

| Responsibility | Notes |
| --- | --- |
| Project selected run events | Curated event rows only. |
| Preserve causal order | Show time/order, type, title, short state. |
| Route details to Inspector | Raw details are not default content. |

First pass event types:

| Type | Meaning | Default visible fields |
| --- | --- | --- |
| `summary` | Agent/run summary update. | time, title, type. |
| `command` | Tool or shell action summary. | time, title, status. |
| `checkpoint` | User decision point. | time, title, waiting status. |
| `artifact` | Output/artifact became available. | time, title, artifact type. |
| `exception` | Blocked/failed incident. | time, title, severity. |

Excluded from main timeline:

| Excluded | Destination |
| --- | --- |
| Token stream fragments | Hidden or logs. |
| Full command output | Inspector detail. |
| Provider-specific lifecycle events | Diagnostics only. |
| Long assistant text | Summary or commentary detail. |

### 2.6 Outputs

Purpose:

| Responsibility | Notes |
| --- | --- |
| Show run artifacts | Not resources, not timeline events. |
| Prioritize latest/primary output | Avoid equal-weight galleries. |
| Overflow safely | Show `+N`, route to Inspector. |

First pass rules:

| Rule | Detail |
| --- | --- |
| Visible count | Show up to 3 tiles and `+N`. |
| Primary artifact | Show first or latest artifact as primary. |
| Click behavior | Tile and `+N` select output detail in Inspector. |
| Empty state | Collapse to a compact status strip. Do not reserve gallery height for `0 visible`. |

Artifact role:

```ts
type ArtifactRole = "primary" | "supporting" | "hidden";
```

### 2.7 Inspector

Purpose:

| Responsibility | Notes |
| --- | --- |
| Explain the selected object | In first pass, default to selected checkpoint. |
| Show evidence and impact | Evidence should be short and actionable. |
| Avoid becoming a second dashboard | Only one selected object at a time. |

First pass selected object:

```ts
type SelectedObject =
  | { type: "checkpoint"; id: string }
  | { type: "run"; id: string }
  | { type: "event"; id: string }
  | { type: "artifact"; id: string }
  | { type: "resource"; id: string };
```

Inspector External Codex evidence rule (minimum contract):

- Level 1 external discovery in inspector is read-only session-log activity observation (not semantic supervision).
- Show up to 3 external Codex sessions in the inspector with workspace/CWD readability, `visibility`, `activityState`, `last activity`, and `last event`.
- Do not treat this as semantic supervision or adopt semantic control.
- `pid` is debug metadata only; it must not be the primary visual signal.
- Show `+N` only when overflowed (with total external count tracked by backend).
- Inspector presentation is read-only; no control buttons should appear in this panel.

First pass implementation may simplify to:

```ts
type SelectedObject = { type: "checkpoint"; id: string } | null;
```

Default selection rule:

```text
pending checkpoint > active run > latest artifact > null
```

Checkpoint fields:

| Field | Example |
| --- | --- |
| `id` | `Checkpoint 02` |
| `title` | `direction approval` |
| `status` | `needs approval` |
| `decision` | `Accept Workstream Cockpit v2?` |
| `impact` | `App.css token phase` |
| `evidence` | Up to 3 one-line evidence items. |

### 2.8 CommandBar

Purpose:

| Responsibility | Notes |
| --- | --- |
| State-specific action surface | It is not a generic chat input. |
| Provide the primary action | One primary action at a time. |
| Accept additional direction | Input remains available when safe. |

First pass states:

| State | Primary action | Secondary actions | Input |
| --- | --- | --- | --- |
| `idle` | Create | Attach resource, settings | Enabled |
| `running` | Pause | More | Enabled for steering |
| `waitingApproval` | Approve | Revise, Evidence, More | Enabled for conditions |
| `blocked` | Inspect | Retry, Abort, More | Enabled for recovery context |
| `observeOnly` | Inspect | Convert to task, More | Ask/comment only |
| `externalObserve` | Inspect | More | Ask/comment only |

Do not duplicate all Inspector actions in the command bar. The command bar may expose the current primary action and a `More` menu only.

## 3. Shared enums

### 3.1 Tone

```ts
type Tone =
  | "neutral"
  | "active"
  | "waiting"
  | "blocked"
  | "external"
  | "approval";
```

Mapping:

| Tone | Use |
| --- | --- |
| `neutral` | Default surfaces, inactive metadata. |
| `active` | Healthy managed run, current workstream. |
| `waiting` | Waiting on user or queue. |
| `blocked` | Exception, failed, cannot continue. |
| `external` | External/observe-only resource or run. |
| `approval` | Human decision point. |

Visual rule:

| Token | First pass style |
| --- | --- |
| tone border | 1px border or left state bar. |
| tone badge | compact text badge. |
| tone background | soft tint only, not full saturated blocks. |

### 3.2 Capability

```ts
type Capability =
  | "enabled"
  | "disabled"
  | "readonly"
  | "requiresLogin";
```

Mapping:

| Capability | Behavior |
| --- | --- |
| `enabled` | Button/input can execute. |
| `disabled` | Visible but inactive; explain only if necessary. |
| `readonly` | Observe-only; allow inspect/ask, not control. |
| `requiresLogin` | Login required before action. |

Observe-only rule:

| Allowed | Disallowed |
| --- | --- |
| Ask/comment | Approve |
| Inspect | Pause |
| Open resource detail | Retry controlled run |
| Show PID/path/state evidence | Convert or adopt silently |

### 3.3 Region state

```ts
type RegionState = "empty" | "loading" | "active" | "error";
```

Rules:

| State | UI |
| --- | --- |
| `empty` | Compact empty visual and one short label. |
| `loading` | Compact progress visual; keep last known data if available. |
| `active` | Normal region content. |
| `error` | Inline blocked/error card scoped to region. |

## 4. Data projection table

This table maps v2 regions to current app state. It should be refined during implementation, but the region names should remain stable.

| Region | Current candidate sources | First pass projection |
| --- | --- | --- |
| `TopStatusBar` | `settings`, `codexAuth`, `activeWorkspace`, `activeSessionMode` | identity + control boundary badges |
| `WorkstreamRail` | `sessions`, `tasksBySession`, `observedCodexState`, `workspaces` | session/workstream cards + resource/exception compact groups; external Codex stays in resources |
| `CurrentTask` | `activeSession`, `tasksBySession`, `turnIntentBySession`, `proposalPanelState` | current task title + workstream context + status strip |
| `ActiveRun` | `runtimeSnapshotBySession`, `streamProgressBySession`, `streamMonitorBySession` | current run summary and capability |
| `Timeline` | `runtimeSnapshot.items`, stream monitor, proposals, decisions | curated event rows |
| `Outputs` | proposals, decision preview, file preview, runtime artifacts | up to 3 artifact-like outputs + overflow |
| `Inspector` | selected checkpoint/proposal/file/resource | selected checkpoint shell in first pass |
| `CommandBar` | login state, send state, stream state, selected checkpoint, active mode | state label + input + primary action |

## 5. First pass component list

Create or extract only if it reduces `App.jsx` complexity. Otherwise keep helpers local while the projection settles.

| Component | Purpose |
| --- | --- |
| `TopStatusBar` | App identity and control boundary. |
| `WorkstreamRail` | Workstreams, exceptions, resources. |
| `CurrentTaskPanel` | Current task header and status strip. |
| `RunTimeline` | Run summary and curated event rows. |
| `OutputTray` | Artifact tiles and overflow. |
| `InspectorPanel` | Selected checkpoint detail. |
| `CommandBar` | State-specific action surface. |
| `StatusPill` | Shared tone/capability visual. |
| `EmptyVisual` | Compact non-text empty/loading indicator. |

## 6. Text policy

Runtime UI text should be terse.

Rules:

| Rule | Example |
| --- | --- |
| Prefer object + state | `Checkpoint 02 · direction approval` |
| Prefer single-word buttons | `Approve`, `Revise`, `Evidence`, `Pause` |
| Avoid internal abbreviations | Use `Checkpoint`, not `CHK`. |
| Avoid explanatory paragraphs | Move to docs, hover, or detail. |
| Keep one language per UI surface | v2 uses English for visible UI. |

Allowed technical terms:

| Term | Reason |
| --- | --- |
| `Codex` | Product/tool name. |
| `OpenPencil` | Product/tool name. |
| `App.css` | File/implementation reference. |
| `Token` | Design-system term. |
| `.op` | File extension. |

## 7. Responsive policy

First pass only needs desktop-safe responsiveness.

| Width | Layout |
| --- | --- |
| `>= 1320px` | Three-column shell: rail, main, inspector. |
| `< 1320px` | Inspector collapses or moves below main. |
| `< 940px` | Rail collapses or stacks; command bar remains bottom. |

Rules:

| Rule | Reason |
| --- | --- |
| No horizontal overflow | Prevent OpenPencil-style overlap from entering production. |
| Avoid visible scrollbars by default | Use curation, caps, overflow counts, and detail routing before internal scroll. |
| Timeline owns spare vertical space | It stores history, so empty vertical space belongs there before Outputs or CommandBar. |
| Inspector content is capped in the shell | Deeper evidence routes to detail views instead of pushing the command bar. |
| Command bar remains accessible | User action surface must stay reachable. |

## 8. Acceptance checklist

Before implementation is considered aligned with v2:

| Check | Expected |
| --- | --- |
| Can identify current task in 5 seconds | `CurrentTask` is visually dominant. |
| Can identify whether user action is needed | `Checkpoint` and `CommandBar` agree. |
| Can distinguish managed vs observe-only | Capability and badges are explicit. |
| Text is not explanatory by default | No long paragraphs in main shell. |
| Timeline is not raw log stream | Only curated event types are visible. |
| Outputs are artifacts only | No resources or logs mixed into output tray. |
| Empty outputs do not create a large panel | `0 visible` is a strip, not a blank gallery. |
| Topbar does not repeat local status | It only shows identity and control boundary. |
| External supervision does not alter IA | Observed Codex is visible in Resources/Inspector without becoming a managed workstream. |
