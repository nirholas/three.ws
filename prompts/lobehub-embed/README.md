# LobeHub embed — series index

Priority 5 in the [top-level stack](../README.md). One of two parallel host-integration series; the other is [claude-artifact/](../claude-artifact/).

## Why this series matters

LobeHub is the **primary** integration target for embodied-agent rendering inside a host chat. When a LobeHub chat talks to a 3D Agent, the agent should render **embodied** — a 3D avatar driven by the [Empathy Layer](../../src/agent-avatar.js) — inside the chat UI, not as invisible JSON.

The user has a LobeHub fork. We are building a first-class plugin that:

1. Declares a LobeHub plugin manifest pointing at our hosted [public/agent/embed.html](../../public/agent/embed.html).
2. Handshakes with the LobeHub chat host via `postMessage`.
3. Passes the chat model's tool calls and messages **into** our [agent-protocol](../../src/agent-protocol.js) so the avatar speaks, gestures, and reacts emotionally in real time.
4. Passes signed agent actions **back out** to LobeHub so the chat history records what the avatar did.
5. Ships to the LobeHub plugin marketplace.

## Tasks — execute in order

| # | File | Ships |
|---|---|---|
| 01 | [01-plugin-manifest.md](./01-plugin-manifest.md) | LobeHub plugin JSON manifest; hosted at a public URL; declares iframe + API surface |
| 02 | [02-iframe-handshake.md](./02-iframe-handshake.md) | `postMessage` protocol between host and embed: init, agent-id resolution, action relay, resize, errors |
| 03 | [03-host-auth-handoff.md](./03-host-auth-handoff.md) | Identify LobeHub viewer; optional wallet link via SIWE; graceful anon path |
| 04 | [04-action-passthrough.md](./04-action-passthrough.md) | Chat → protocol relay (speak, gesture, emote); avatar-signed actions → chat |
| 05 | [05-plugin-submission.md](./05-plugin-submission.md) | Package, local-test against LobeHub dev instance, marketplace submission PR |

## Rules that apply to every task in this series

**These are not quick tasks.** LobeHub is the primary integration target — each task must be thorough, not rushed. If LobeHub API details are unclear at the time of writing, the task prompts say "confirm against current LobeHub docs" rather than fabricating. The doing-agent should honor that and read the current docs.

- No new runtime dependencies unless the task file explicitly allows them.
- No new docs files (README.md, CLAUDE.md) unless the task says so.
- `node --check` every modified JS file.
- `npx vite build` and report result. Pre-existing `@avaturn/sdk` warning is unrelated — ignore.
- The [Empathy Layer](../../src/agent-avatar.js) is the novel selling point. **Every task must protect its behavior.** Do not disable, bypass, or flatten emotion blending for "embed mode". The embed context is where it shines.
- `.well-known/agent-card.json` is an A2A card; LobeHub may or may not natively consume it. Treat as auxiliary, not primary.
- [ERC-8004 identity](../../src/erc8004/) is wired but **must be optional** for the embed to work. Anon LobeHub users should get a functional avatar.
- Respect `Files off-limits` sections — other tasks may be editing them.
- If you discover an unrelated bug, note it in your report. Do not fix it in the same change.

## Reporting

Each task ends with a short report: files created, files edited (which sections), commands run and their output, manual verification URLs hit against a local LobeHub dev instance or mock, any uncertainty flagged for later confirmation.
