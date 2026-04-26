# Solo Observability Model

Last updated: 2026-04-25

This document defines what Solo should observe, what it may control, and what the UI is allowed to present as product truth.

It is a design gate for implementation work. Do not add runtime features until the change fits this model.

## 1. Product objective

Solo is an agent-era observability and control system for human-in-the-loop work.

The first useful version is not "monitor a process". It is:

| Question | Solo should answer |
| --- | --- |
| What is the agent trying to do? | Current task, turn intent, selected workstream. |
| Is work progressing? | Activity state, latest meaningful event, stale/running/waiting signal. |
| What is blocked? | Exception, approval request, missing input, failed command, unavailable resource. |
| What changed or was produced? | Artifacts, previews, decisions, file/command proposals. |
| What can the user safely do now? | Approve, revise, inspect, create task, attach resource, or do nothing. |

If a signal cannot answer one of these questions, it is diagnostics, not primary UI.

## 2. Session classes

Solo must separate ownership from observation.

| Class | Created by | Solo owns runtime? | Solo may control? | UI location |
| --- | --- | --- | --- | --- |
| `managedSession` | Solo | Yes | Yes, through Solo runtime and approval gates. | Workstreams, current task, timeline, command bar. |
| `observedExternalSession` | External Codex/CLI | No | No, read-only by default. | Resources and inspector evidence. |
| `localResource` | User/Solo | N/A | Attach/open only. | Resources. |

Rules:

| Rule | Reason |
| --- | --- |
| A discovered PID is never a workstream by itself. | Process identity is not task semantics. |
| An external Codex session is observe-only until explicitly adopted by a future protocol. | Avoid silent takeover and false control. |
| A Solo-spawned Codex process belongs to its managed session, not external resources. | Avoid double-counting. |
| Managed sessions are the canonical path for control features. | Solo has the lifecycle, turn ids, approvals, and event projection. |

## 3. Signal ladder

Solo should treat observation as levels. UI copy and controls must not imply a higher level than the data supports.

| Level | Name | Meaning | Allowed UI |
| --- | --- | --- | --- |
| L0 | Process discovery | A process exists, with pid/cwd/age. | Diagnostics only. |
| L1 | Activity observation | Recent session/event activity can be inferred. | Activity state, last event type, stale/running/waiting hint. |
| L2 | Semantic supervision | Solo knows task, intent, checkpoints, outputs, and exceptions. | Workstream timeline, inspector evidence, action recommendation. |
| L3 | Safe intervention | Solo can pause/retry/approve/revise through owned runtime gates. | Command bar controls. |
| L4 | Managed multi-agent control | Solo coordinates multiple managed workstreams. | Scheduling, delegation, review, merge control. |

Current target:

| Area | Target level |
| --- | --- |
| Solo-created Codex sessions | L2 foundation, L3 only where approvals already exist. |
| Existing external Codex sessions | L1 maximum unless a future adoption protocol is designed. |

## 4. Canonical runtime projection

Provider events must be projected into Solo primitives before the UI uses them.

```ts
type SoloObservable =
  | ManagedSession
  | ObservedExternalSession
  | Workstream
  | Turn
  | RuntimeItem
  | Artifact
  | Exception
  | Checkpoint
  | Resource;
```

Minimum projection fields:

| Field | Meaning |
| --- | --- |
| `owner` | `solo` or `external`. |
| `capability` | `managed`, `observeOnly`, `readonly`, or `requiresLogin`. |
| `activityState` | `running`, `waiting`, `stale`, `blocked`, `idle`, or `unknown`. |
| `currentIntent` | What Solo expects next: `create`, `send`, `approve`, `revise`, `inspect`, `wait`. |
| `latestMeaningfulEvent` | Curated event, not token stream noise. |
| `evidence` | Short facts supporting the current state. |
| `debug` | pid, raw provider ids, command line, and other non-primary metadata. |

UI rule:

| Do | Do not |
| --- | --- |
| Render `activityState`, `currentIntent`, and `evidence`. | Render pid/cwd as the main signal. |
| Render curated timeline items. | Render raw provider logs or token events. |
| Route long detail to inspector. | Fill the shell with explanatory paragraphs. |
| Cap visible rows and show `+N`. | Add default internal scrollbars. |

## 5. Managed session contract

Solo-created sessions should become the reference path.

Required lifecycle:

| Phase | Runtime projection |
| --- | --- |
| Task created | `Workstream` + current `Task`. |
| Turn started | `Turn(status=running)` + initial `RuntimeItem(status=running)`. |
| Provider stream arrives | Curated `RuntimeItem` updates with dedupe/limits. |
| Proposal/checkpoint appears | `Checkpoint` or preview item, user action required. |
| Artifact appears | `Artifact(role=primary/supporting/hidden)`. |
| Turn completes | `Turn(status=completed)` and task returns to waiting/idle. |
| Turn fails | `Exception` + failed runtime item. |

Implementation guardrails:

| Guardrail | Reason |
| --- | --- |
| Event projection must be lossy and curated. | Timeline is not a log viewer. |
| Provider event types stay in metadata. | UI should not depend on Codex internals. |
| Approval remains Solo-owned. | Human-in-the-loop is the commit boundary. |
| The command bar reflects Solo state, not provider state directly. | Prevent false affordances. |

## 6. Observed external session contract

External sessions are useful as situational awareness, not control.

Allowed signals:

| Signal | Source |
| --- | --- |
| Workspace/cwd | Process metadata or session metadata. |
| Activity state | Recent session event timestamp/type if available. |
| Visibility | `sessionLog`, `processOnly`, or `unknown`. |
| Last activity | Timestamp only. |
| Last event type | Provider event type, mapped to a terse label. |

Disallowed by default:

| Disallowed | Reason |
| --- | --- |
| Pause/retry/approve buttons | Solo does not own the runtime. |
| Treating external session as active workstream | No Solo task/turn/checkpoint contract. |
| Showing raw message text as surveillance | Privacy and product clarity. |
| Promoting pid as the main title | It is diagnostics only. |

## 7. Implementation gates

Every implementation task must pass these gates before code is delegated.

| Gate | Required answer |
| --- | --- |
| Ownership | Is this `managedSession` or `observedExternalSession`? |
| Level | Which observation level does the data actually support? |
| Primitive | Which Solo primitive is updated? |
| UI region | Which region consumes the projection? |
| Control boundary | What controls are allowed, and what is explicitly disallowed? |
| Validation | What screenshot/build/check proves alignment? |

Spark or other worker agents should only receive tasks after these answers are explicit.

## 8. Next implementation slice

The safest next code slice is:

| Step | Scope |
| --- | --- |
| 1 | Add/clean a projection helper that maps existing runtime/session/resource state into `activityState`, `currentIntent`, `capability`, and `evidence`. |
| 2 | Make the UI read that projection instead of scattered raw state. |
| 3 | Keep external Codex observe-only and remove any UI that implies control. |
| 4 | Validate with a real Tauri screenshot and no visible default scrollbars. |

Do not start by adding more provider parsing. First make the Solo projection boundary explicit in code.
