# Solo

Solo is an observability system for the agent era, built with `React + Tauri`
for Linux.

It is no longer best understood as a human-in-the-loop chat workbench.
The more accurate framing now is:

- the agent is strong enough to execute substantial work with limited supervision
- the human increasingly behaves like a product manager or project manager
- Solo should make agent work visible, manageable, traceable, and intervenable

In one line:

- `Solo = desktop observability and control plane for agent work`

The name `Solo` still means:

- it is built first for solo developers
- one person should be able to supervise multiple agent workstreams from one tool
- planning, execution state, artifacts, blockers, and interventions should live in one desktop product

In Chinese, the product direction can now be summarized as:

> `Solo`：agent 时代的任务观测与控制工作台

## What Solo Should Solve

As agent capability improves, the bottleneck shifts away from "can it answer?"
and toward:

- what is each agent working on
- which tasks are blocked, delayed, or off track
- what resources are being consumed or competed for
- what changed, why it changed, and who or what caused it
- when the human should intervene, rather than being asked every few steps

So Solo is not primarily trying to be:

- another chat shell
- another terminal wrapper
- another pseudo IDE
- a UI that asks the user to approve every tiny action

It should instead become the place to:

- manage tasks
- manage schedule and progress
- coordinate resources
- inspect runs and artifacts
- trace execution state and history
- intervene at milestones, exceptions, or failures

## Current Product Direction

The current strategic direction is:

- observability-first, not chat-first
- the user acts more like a PM than a step-by-step operator
- chat is only one control surface, not the product identity
- workspace context is a resource dimension, not the main product mode
- approvals should move toward checkpoints and exception handling, not default micro-confirmation
- runtime ownership matters more than polishing prompt-shaped UI

## Current V1 Reality

The repository is still in a transitional state.

Today it already has:

- local sessions, workspaces, and settings persisted on disk
- `codex_cli` as the main execution path
- a `conversation / workspace collaboration` shell
- streamed progress and runtime snapshots
- proposal and approval flows
- early `task / turn / item` persistence skeleton in Rust

But this V1 shape should now be treated as a bridge, not the destination.
The long-term product should move toward:

- `workstream / task / run / event / resource / artifact / checkpoint`
- task board and timeline views
- agent run inspection and replay
- resource coordination and blocker tracking
- structured intervention points instead of constant natural-language back-and-forth

## Project Context

See [CONTEXT.md](./CONTEXT.md) for the current repo-level direction and near-term
plan.

See [docs/solo-control-plane.md](./docs/solo-control-plane.md) for the main
product reframe toward an agent observability system.

## Development

```bash
npm install
npm run tauri dev
```

## Build checks

```bash
npm run build
cd src-tauri && cargo check
```

## License

Solo is released under the `Apache-2.0` license.

This keeps the desktop client open source while preserving room for future
commercial offerings built around hosted services, cloud features, or paid
extensions.
