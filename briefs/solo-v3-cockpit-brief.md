# Solo v3 cockpit design brief

## Product stance

Solo is a personal local desktop observability and control plane for agent work.

v3 should not look like a generic task board, chat UI, IDE, SaaS admin panel, or log viewer. It should feel like a dense but calm control console for one developer supervising agent work.

## Key correction from v2

v2 had a usable visual language, but its information model was still too spread out:

- Timeline, active run, detail, and history duplicated each other.
- External Codex occupied too much attention for observe-only data.
- Text prompts were too long.
- Some panels existed because data was available, not because the user needed to act.
- Large empty areas appeared while history was hidden.

v3 should make the screen answer four questions immediately:

1. What is happening now?
2. Is there risk or a required decision?
3. What can I do next?
4. What evidence explains this state?

## Design principles

### 1. Cockpit, not log viewer

The center of the screen is not a raw timeline. It is a live run cockpit:

- Current state.
- Phase progress.
- Risk/decision card.
- Evidence summary.
- Latest meaningful events.

Raw history is available, but not primary.

### 2. No visible scrollbars

The first screen must close the loop without internal scrollbars.

Use:

- Priority ordering.
- Folding.
- Pagination.
- Compact cards.
- Detail drilldown.

Do not solve density with scroll containers.

### 3. Few strong signals

Use four semantic colors:

- Running: muted green.
- Decision/approval: amber.
- Risk/failure: red.
- Done/stable: muted grey.

External/observe-only can use desaturated teal, but only as secondary context.

Everything else should be grey or subdued.

### 4. Text budget

Every primary card has a text budget:

- Normal status: 3-5 words.
- Hint: one short sentence.
- Risk: maximum two lines.
- Long evidence: detail rail only.

No paragraph-like explanations in primary panels.

### 5. Checkpoint is a first-class interrupt

Approval or blocked states must not appear as ordinary timeline events.

They should become an interrupt card:

- Clear decision question.
- Risk/impact.
- Primary action.
- Secondary action.
- Evidence entry.

### 6. Detail rail is contextual

Right rail has exactly one purpose at a time:

- Decision required.
- Selected event detail.
- Failure diagnosis.
- Folded history.

It should not permanently show External Codex or debug metadata.

### 7. External observe-only is secondary

External Codex is useful, but it must not steal the managed run's main focus.

Rules:

- Show external sessions in the resource/side lane.
- Mark them observe-only.
- Only open detail when selected or risky.
- Never make external observe-only the main CTA when a managed run exists.

## Required layout

Canvas: desktop app frame, 16:9-ish wide, dark developer-tool aesthetic.

### Top bar

Compact identity and workspace:

- `solo / control plane`
- current workspace path
- branch
- auth/status chips

No repeated top metrics like `blocked / approvals / external` if they duplicate side panels.

### Left rail

Workstreams grouped by:

- Active
- Waiting
- Done

Below that, Resources:

- Current workspace.
- Observe-only external Codex as secondary.

Keep cards compact. Avoid long summaries.

### Center cockpit

Use one main shell with four zones:

1. Current run strip
   - Task title.
   - Agent state.
   - elapsed / latest activity.
   - phase: `Plan -> Edit -> Run -> Check`.

2. Interrupt slot
   - If checkpoint/blocked exists, show strong decision/failure card.
   - If no interrupt, show compact live status card.

3. Evidence timeline
   - Show 4-6 latest meaningful events.
   - Failures and decisions outrank routine done/status events.
   - Fold old events into `History`.

4. Outputs strip
   - Artifacts only when they exist.
   - Empty state should be one short line.

### Right detail rail

Header:

- `Detail`
- selected target title
- status chip

Body variants:

- Decision: question, impact, actions, evidence.
- Failure: cause, impact, recovery, evidence.
- Event: summary, raw evidence collapsed, files if relevant.
- History: page of folded events with `Back to live run`.

Actions must be close to the object they affect.

### Bottom command bar

The command bar changes semantics by state:

- Idle: `Start task`.
- Running: `Steer run` plus `Interrupt`.
- Blocked: answer blocker.
- Approval: `Approve`, `Revise`, `Evidence`.

Do not just change placeholder text.

## Visual direction

Keep:

- Deep dark desktop tool feel.
- Tight columns and aligned grids.
- Mono labels for state and data.
- Strong but sparse borders.

Change:

- Reduce green wash. Base should be charcoal/graphite, not moss.
- Raise the overall brightness one step: avoid near-black dead surfaces. Use graphite (`#151411` / `#171612` range) as the base instead of pure black.
- Keep night-mode developer-tool character, but improve contrast enough that text and panel edges do not feel muddy.
- Use amber only for decision/control emphasis.
- Use red only for true risk/failure.
- Use teal only for observe-only/external.
- Reduce roundedness slightly.
- Reduce padding where it does not help scanning.

## Example state to design

Design the screen for this state:

- Managed run active in `/home/chikee/workspace/cocoa`.
- Task: `Review cocoa next direction`.
- Agent is running but has emitted no token for 18 seconds.
- Latest phase: `Inspecting repo`.
- There is one previous failure: `CLI failed to record rollout items`, but it is non-blocking.
- No approval is currently pending.
- One external Codex is observed in the same workspace, observe-only.
- Four meaningful events are visible:
  - Agent response.
  - User request.
  - Non-blocking CLI failure.
  - Older events folded.
- Right rail is showing the selected non-blocking CLI failure with cause/impact/recovery/evidence.

## Review notes from critique agents

- Do not start the hierarchy from raw timeline.
- Failure page must show cause, impact, recovery, not raw stderr first.
- Control actions should sit near the observed object.
- `Back to live run` must always be visible when inspecting history/detail.
- Command bar state changes must be semantically different, not placeholder-only.
- Card count should feel like an instrument panel, not a document page.
- UI language should be consistent; technical entities can remain English.
