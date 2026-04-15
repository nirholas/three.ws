---
mode: agent
description: "Lobehub (or any MCP host) imports an agent directly from its on-chain record"
---

# 06-04 · Lobehub onchain import

## Why it matters

This is the specific demo that proves the whole product thesis: a user in Lobehub pastes an on-chain agent id → the embodied agent appears in chat, pulled from the chain, not from our DB. If we can do this for Lobehub, the pattern generalizes to every host.

## Prerequisites

- 05-02 (Lobehub plugin) and 06-03 (chain resolver).

## Read these first

- [prompts/build/05-02-lobehub-plugin.md](./05-02-lobehub-plugin.md) — plugin shape.
- Lobehub plugin docs for "variable input" patterns.

## Build this

1. **Extend the Lobehub plugin manifest** (05-02) with an alternate input mode:
   - `{ chain_id, erc8004_id }` instead of / in addition to `{ agent_id }`.
2. **Resolver call** — plugin renderer calls `/api/agents/by-chain?...` (06-03) and renders the returned `embed_url` in its iframe renderer.
3. **Native chat command** — document a `/3d-agent chain:1 id:42` slash-command pattern for the Lobehub fork. Include a minimal command-parser snippet in the PR; the user will wire it into their fork.
4. **End-to-end test** — in the user's Lobehub fork, trigger the import with a known on-chain id and verify the avatar appears embodied inline.

## Out of scope

- Writing code inside the Lobehub fork repo — we deliver the integration points; the user owns fork changes.
- Cross-chain aggregation.

## Deliverables

- Updated plugin manifest endpoint.
- A short "How to wire in your fork" note (in the PR description only — not a new docs file).

## Acceptance

- Slash-command in a local Lobehub build pulls the agent from chain and renders.
- Error states (no such chain id, no such agent id) are clear.
- `npm run build` passes.
