# Solo vs Multica positioning

Last updated: 2026-04-26

## Why this document exists

Multica changes the bar for Solo. It is not a reason to avoid agent management features. It is evidence that task boards, managed agents, progress tracking, daemon runtimes, workspaces, and skills are becoming baseline capabilities for agent control-plane products.

The product question is therefore not:

- Should Solo avoid what Multica does?

The better question is:

- If Solo also contains those capabilities, where does Solo make them meaningfully better for a personal local desktop workflow?

## Source signals

Primary source:

- <https://github.com/multica-ai/multica>

Local Solo context:

- [docs/solo-control-plane.md](../solo-control-plane.md)
- [docs/solo-architecture.md](../solo-architecture.md)
- `/home/chikee/workspace/notes/solo-runtime-boundary.md`
- `/home/chikee/workspace/notes/solo-phase-1-runtime-todo.md`

## What Multica appears to validate

Multica validates several assumptions Solo should not ignore:

- Agent work needs a runtime, not just chat messages.
- Agent work needs task-level state, not only a transcript.
- Long-running work needs progress streaming and resumable process management.
- Skills and reusable procedures are part of the agent product surface.
- Users need a board-like view when multiple agents or tasks are active.
- A daemon/runtime process can be a reasonable architecture for managed agent work.

These are not differentiators anymore. They are table stakes.

## What Solo should absorb

Solo should not reject a capability just because Multica has it. The following should be considered baseline Solo capabilities:

- Workstreams and tasks as first-class objects.
- Managed runs launched by Solo.
- Runtime events with status, duration, output, and failure state.
- A compact board or cockpit for active/waiting/done work.
- Skills as reusable operational context.
- Workspace/resource attachment.
- Checkpoint and approval states.
- External agent observation when the agent was not launched by Solo.

The key constraint: these capabilities must be projected through Solo's own runtime model. They should not be bolted on as provider-specific UI patches.

## Where Solo should not compete head-on

Solo should avoid copying Multica's broad platform shape unless there is a clear personal-desktop reason.

Do not optimize first for:

- Team assignment and organization-level collaboration.
- Cloud-hosted multi-user agent management.
- GitHub issue autopilot as the primary product loop.
- Heavy backend dependencies before the local runtime model is stable.
- Provider-neutral breadth before Codex/OpenAI local workflows are excellent.
- A generic agent marketplace before Solo has a strong workstream/run/event protocol.

These may be future extensions, but they should not drive the first strong version.

## Solo's better battlefield

Solo should compete by being a sharper local cockpit for one power user.

### 1. Local-first desktop control plane

Solo should feel like a native development tool, not a hosted team board.

Implications:

- Local app state remains authoritative.
- Workspaces are local repos and directories.
- Existing terminal/Codex sessions can be observed.
- Managed sessions can be launched without cloud orchestration.
- The app remains light enough to run beside the editor and terminal.

### 2. Observability before orchestration

Multica-style orchestration is useful, but Solo should first make agent work observable.

Solo's core question:

- What is the agent doing, why is it in this state, what changed, what failed, and where must the user intervene?

This means the core surface should prioritize:

- Timeline events.
- Failure and exception priority.
- Checkpoints requiring human action.
- Artifacts and evidence.
- Resource usage and conflicts.
- History folding with recoverable detail.

### 3. Human checkpoint as product primitive

Solo should not reduce approval to a generic button.

A checkpoint should contain:

- The decision needed.
- The evidence for the decision.
- The impact of approving.
- The rollback or risk boundary.
- A way to ask for revision instead of accepting.

This matches the existing Solo direction: suggestion, preview, user confirmation.

### 4. Runtime protocol ownership

Solo should own these primitives:

- `workstream`
- `task`
- `run`
- `event`
- `artifact`
- `checkpoint`
- `resource`

Codex CLI, OpenAI API, or any future provider should map into these primitives. They should not define them.

This is the main architectural line that prevents Solo from becoming a thin wrapper around one provider.

### 5. Personal developer ergonomics

Solo can be better by being less general.

Strong first-user assumptions:

- One developer.
- Local Linux desktop.
- Multiple local workspaces.
- Codex/OpenAI-heavy workflow.
- Frequent switching between terminal, editor, browser, and Solo.
- User wants supervision and intervention, not autonomous black-box delegation.

## Product stance

Solo can contain Multica-like features, but the implementation stance should be:

- Include baseline runtime and board capabilities.
- Do not clone a team agent platform.
- Make local observability, checkpoint quality, and evidence recovery better.
- Keep the desktop app lighter than a cloud orchestration product.
- Prefer a small strong runtime protocol over a wide feature matrix.

## Immediate roadmap impact

### Keep

- Managed Codex sessions.
- External Codex observation.
- Workstream/task/run/event model.
- Runtime timeline.
- Right-side detail/decision rail.
- Resource attachment.
- Checkpoints and approvals.

### Tighten

- Timeline priority: failures, exceptions, and decisions must outrank routine `done` events.
- Detail panel: selected event, checkpoint, or failure only. No permanent low-value panels.
- History: folded by default, recoverable through explicit detail mode.
- Active run: only when something is actually running, blocked, loading, or waiting approval.

### Defer

- Team features.
- Cloud daemon management.
- GitHub issue autopilot as main loop.
- Multi-user assignment.
- Broad provider marketplace.

### Cut or demote

- UI elements that exist only because data is available.
- External session details that do not require attention.
- Repeated status chips that duplicate stronger context.
- Long prompt-like text in primary panels.

## Next implementation target

The next implementation target should be:

- Stabilize Solo's runtime projection around `task -> run -> event -> checkpoint -> artifact`.

Concrete next slice:

1. Define a single frontend projection function for cockpit data.
2. Make timeline and right detail consume that projection only.
3. Keep provider-specific raw data out of primary UI components.
4. Add a small fixture/demo state for the projection so UI regressions can be reviewed without waiting for a live Codex run.

This keeps the Multica lesson useful without letting Solo drift into a low-quality clone.
