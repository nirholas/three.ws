# LobeHub embed — series index

Priority 5 in the [top-level stack](../README.md). One of two parallel host-integration series; the other is [claude-artifact/](../claude-artifact/).

> **Before dispatching any 01–08 task, read [AUDIT.md](./AUDIT.md).** It flags stale paths, confusing numbering, two sub-stacks mixed in one folder, and spec unknowns that block plugin work.

## Two parallel deliverables in this folder

| Deliverable                                                                                  | Ships to                   | Tasks                                                               |
| -------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------- |
| **Fast path** — mount the avatar in your own LobeHub fork's right sidebar                    | your fork only, not public | [00-fork-sidebar-fastpath.md](./00-fork-sidebar-fastpath.md)        |
| **Plugin stack** — marketplace plugin so anyone's LobeHub can install                        | LobeHub plugin marketplace | [01](./01-plugin-manifest.md) → [05](./05-plugin-submission.md)     |
| **Host SDK + mention UX** — `@3dagent/embed` npm package + inline `@mentions` + autocomplete | npm + your fork            | [06](./06-host-sdk-package.md) → [08](./08-mention-autocomplete.md) |

Dispatch **task 00 first** — it ships the demo today. Then pick plugin, SDK, or both.

## Why this series matters

LobeHub is the **primary** integration target for embodied-agent rendering inside a host chat. When a LobeHub chat talks to a three.ws, the agent should render **embodied** — a 3D avatar driven by the [Empathy Layer](../../src/agent-avatar.js) — inside the chat UI, not as invisible JSON.

## Task index

| #   | File                                                         | What it ships                                                                 | Blocks on                                              |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| 00  | [00-fork-sidebar-fastpath.md](./00-fork-sidebar-fastpath.md) | Iframe mounted in the fork's right sidebar; persistent; reacts to chat stream | nothing                                                |
| 01  | [01-plugin-manifest.md](./01-plugin-manifest.md)             | `.well-known/lobehub-plugin.json` manifest hosted publicly                    | resolving `TODO(lobehub-spec)` flags (see AUDIT.md §6) |
| 02  | [02-iframe-handshake.md](./02-iframe-handshake.md)           | Versioned `postMessage` bridge module `src/embed-host-bridge.js`              | 01                                                     |
| 03  | [03-host-auth-handoff.md](./03-host-auth-handoff.md)         | Anon / host-user / wallet-linked identity tiers with opt-in SIWE prompt       | 02                                                     |
| 04  | [04-action-passthrough.md](./04-action-passthrough.md)       | Bidirectional chat-tool ↔ protocol relay `src/embed-action-relay.js`         | 02, 03                                                 |
| 05  | [05-plugin-submission.md](./05-plugin-submission.md)         | Marketplace submission bundle + smoke test fixtures                           | 01–04                                                  |
| 06  | [06-host-sdk-package.md](./06-host-sdk-package.md)           | `@3dagent/embed` npm package (`packages/embed/`)                              | nothing (can parallel 01–05)                           |
| 07  | [07-message-renderer.md](./07-message-renderer.md)           | Inline `<AgentMention>` React component for @-tokens in chat                  | 06                                                     |
| 08  | [08-mention-autocomplete.md](./08-mention-autocomplete.md)   | `@`-trigger suggest menu + `GET /api/agents/suggest` endpoint                 | 07                                                     |

## Rules that apply to every task in this series

**These are not quick tasks.** LobeHub is the primary integration target — each task must be thorough, not rushed. If LobeHub API details are unclear at the time of writing, the task prompts say "confirm against current LobeHub docs" rather than fabricating. The doing-agent should honor that and read the current docs.

- No new runtime dependencies unless the task file explicitly allows them.
- No new docs files (README.md, CLAUDE.md) unless the task says so.
- `node --check` every modified JS file.
- `npm run verify` (prettier + vite build) and report result. Pre-existing `@avaturn/sdk` warning is unrelated — ignore.
- The [Empathy Layer](../../src/agent-avatar.js) is the novel selling point. **Every task must protect its behavior.** Do not disable, bypass, or flatten emotion blending for "embed mode". The embed context is where it shines.
- `.well-known/agent-card.json` is an A2A card; LobeHub may or may not natively consume it. Treat as auxiliary, not primary.
- [ERC-8004 identity](../../src/erc8004/) is wired but **must be optional** for the embed to work. Anon LobeHub users should get a functional avatar.
- Respect `Files off-limits` sections — other tasks may be editing them.
- If you discover an unrelated bug, note it in your report. Do not fix it in the same change.

## Reporting

Each task ends with a short report: files created, files edited (which sections), commands run and their output, manual verification URLs hit against a local LobeHub dev instance or mock, any uncertainty flagged for later confirmation.
