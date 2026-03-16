# Solo

Solo is a Linux desktop AI workbench built with `React + Tauri`.

The name `Solo` means:

- it is built first for solo developers
- the goal is that one person can use Solo to independently complete the development loop
- chat, workspace context, execution guidance, and approval flow should eventually live in one desktop tool

It is designed around two core modes:

- `Chat`: direct conversation using the local `codex` CLI login state
- `Workbench`: optional local workspace context for code-aware analysis and follow-up actions

Current direction:

- ChatGPT-style conversation flow inside the app
- Codex-style local workspace context when needed
- Zed ACP-inspired agent architecture, so model/runtime and editor capabilities stay decoupled
- streamed progress feedback during long replies
- approval-based file edits and command execution
- dark, editor-inspired desktop UI with theme switching

## Current V1 shape

- `codex_cli` as the primary conversation path
- local sessions, workspaces, and settings persisted on disk
- adaptive `chat / workbench` desktop layout
- workspace browsing and file attachment
- read-only tools available to the model without confirmation
- write-file and run-command proposals that require confirmation
- custom in-app window chrome for Linux

## Project Context

See [CONTEXT.md](./CONTEXT.md) for current decisions and next-step plan.

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
