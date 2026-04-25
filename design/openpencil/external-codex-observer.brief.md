# External Codex Observer · OpenPencil Brief

## Surface

Solo desktop control plane screen module.

## Context

Solo is an observability and control plane for agent work. The user may already have a Codex process running in another terminal, for example in `~/workspace/cocoa`. Solo should surface that process as an external, observe-only run. The user is not starting a new session; they are supervising an existing agent.

## Design Goal

Design three UI directions for showing external Codex agents inside Solo without making the app feel like a generic chat shell or terminal wrapper.

## Existing Visual Language

- Dark gruvbox-inspired developer tool interface.
- Dense but controlled control-plane layout.
- Monospace metadata, compact panels, warm borders, muted green accent.
- Current main screen has:
  - left workstream/resource rail
  - top status cards
  - central task timeline / conversation surface
  - bottom command bar

## Functional Requirements

- Show count of running external Codex agents.
- For each agent show:
  - workspace name or unknown workspace
  - pid
  - cwd
  - state: running / sleeping / unknown
  - control level: observe-only
  - last seen time
- If a matching Solo session exists, expose a focus action.
- Never imply that Solo can control or inject input into an externally launched Codex process.
- The state must be visible even when current active workspace is not the matched workspace.

## Design Direction A · Right Dock Radar

Narrative role: ambient radar.

Use a compact bottom-right dock that floats above the main control plane. It should feel like a system monitor overlay, not a modal. It is good for immediate discoverability but should not steal hierarchy from active task status.

Key traits:
- Fixed bottom-right position.
- Compact cards.
- Strong `observe-only` label.
- Minimal actions.
- Best for first implementation and debugging.

## Design Direction B · Resource Rail Integration

Narrative role: resource ownership and occupancy.

Integrate external Codex into the left `RESOURCES / 附加资源` lane. It should read as "this workspace resource is currently occupied by an external agent". This is the recommended long-term direction because it matches Solo's control-plane object model.

Key traits:
- No floating overlay.
- External agent becomes a resource card.
- Workspaces with running Codex receive a visible occupancy marker.
- Unknown workspaces are grouped under "untracked external runs".
- Best for stable product architecture.

## Design Direction C · Top Status Expansion

Narrative role: command-center summary.

Use the existing top `RESOURCES` status card as the entry point. It shows `N external agents`, and expands into a compact popover / panel listing agents. This keeps the dashboard clean and makes agent monitoring part of the global status bar.

Key traits:
- Top-level count.
- Expandable list.
- Good for multiple agents.
- Low visual footprint.
- Risk: discoverability depends on the status card.

## Recommended Direction

Direction B should be selected for production. Direction A can stay as a temporary debug/preview layer. Direction C is useful later when multi-agent counts grow.

## Interaction Level

L1 refined static with subtle hover/focus states only.

No decorative animation. No large blur surfaces. No scroll-jacking. Respect reduced motion.

## Accessibility And UX Constraints

- Do not rely only on color for running/sleeping/unknown.
- Interactive targets should be at least 36px in current desktop density, ideally 44px if space allows.
- Fixed surfaces must respect safe-area insets.
- Empty state must say what is happening: "No external Codex detected" or "Scanning local Codex processes".
- Error state should stay near the external agent module.

## Output Goal

Create an OpenPencil design with three side-by-side directions: A, B, and C. Keep it as a design artifact, not production code.
