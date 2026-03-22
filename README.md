# Solo

Solo is a human-in-the-loop AI workbench for Linux, built with `React + Tauri`.

The name `Solo` means:

- it is built first for solo developers
- the goal is that one person can use Solo to independently complete the development loop
- AI, workspace context, suggestions, previews, and confirmation should eventually live in one desktop tool

In Chinese, the product direction can be summarized as:

> `Solo`：帮助你进入开发心流的人机协作 AI 工作台

Solo is not meant to be an autonomous agent that takes over the build process.  
Its goal is to help a human work better:

- understand problems faster
- compare options more clearly
- preview changes before acting
- keep the final decision in human hands

It is designed around two core modes:

- `Conversation`: fast direct conversation using the local `codex` CLI login state
- `Workspace Collaboration`: optional local workspace context for analysis, suggestions, tradeoffs, and previews

These modes are explicit product states, not hidden heuristics:

- attaching a workspace only makes local context available
- Solo should not silently decide that a normal chat turn is now workspace-aware
- the user explicitly switches a session into `Workspace Collaboration` when they want repository context to participate

Current direction:

- ChatGPT-style conversation flow inside the app
- workspace-aware collaboration only when the user explicitly switches into it
- suggestion + preview + confirmation instead of agent-first autonomous execution
- Zed ACP-inspired architecture, so model/runtime and editor capabilities stay decoupled
- dark, editor-inspired desktop UI with theme switching

## Current V1 shape

- `codex_cli` as the primary conversation path
- local sessions, workspaces, and settings persisted on disk
- adaptive `conversation / workspace collaboration` desktop layout
- workspace browsing and file attachment
- streamed feedback during long replies
- write-file and run-command proposals shown as previews that require user confirmation
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

## License

Solo is released under the `Apache-2.0` license.

This keeps the desktop client open source while preserving room for future commercial offerings built around hosted services, cloud features, or paid extensions.
