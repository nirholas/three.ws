# Band 5 — Claude.ai + LobeHub Integration

## The end state

**Claude.ai / Artifacts**: An MCP tool call returns a self-contained HTML artifact that renders the agent's 3D avatar inline in the Claude conversation. User sees an embodied agent, not a JSON blob.

**LobeHub**: In the user's LobeHub fork (they are the primary integration target), the chat panel has an always-on 3D avatar beside the messages. The avatar:
- is summoned from an agent id or wallet address
- reacts to chat events (typing, speaking, emoting)
- persists across turns in the same session
- can be swapped by entering a different agent id

The novelty is that *the same agent* renders identically in both hosts, because both pull from the same public URL (band 4) or on-chain record (band 6).

## Current state

- `render_avatar` MCP tool exists (`api/mcp.js`) and returns a `<model-viewer>` HTML string. Claude Artifacts accept HTML, so this is 80% there — needs art direction: must be self-contained, no external writes, correct sandbox posture.
- LobeHub is the user's fork. We don't own it — the deliverable is a plugin / component that drops into it.
- Agent protocol (`src/agent-protocol.js`) and the Empathy Layer (`src/agent-avatar.js`) exist — these emit/consume events. LobeHub integration wires chat events into the protocol.

## Prompts in this band

| # | File | Depends on |
|---|---|---|
| 01 | [claude-artifact.md](./01-claude-artifact.md) | band 4 public embed solid |
| 02 | [lobehub-plugin-scaffold.md](./02-lobehub-plugin-scaffold.md) | — |
| 03 | [lobehub-chat-bridge.md](./03-lobehub-chat-bridge.md) | 02 |
| 04 | [agent-from-url-or-id.md](./04-agent-from-url-or-id.md) | 02 |

## Done = merged when

- In Claude.ai, invoking `render_avatar` opens an Artifact that shows the avatar interactively — no blank frame, no broken fonts, no external auth required.
- In the user's LobeHub fork, opening a chat shows a persistent avatar pane; typing in chat triggers a subtle emotion response; changing the agent id in a config field swaps the avatar without reloading the page.
- Both hosts render the **same** avatar from a shared agent id and look ~identical.

## Off-limits for this band

- Don't fork LobeHub in our repo. Ship a plugin / component they can drop in.
- Don't build a generic `<agent-3d>` web component here if one already exists — extend it.
- Don't wire on-chain resolution here — band 6 owns that. Use URL / id-based resolution for now.
