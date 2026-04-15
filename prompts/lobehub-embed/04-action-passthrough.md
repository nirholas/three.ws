# Task 04 — chat ↔ avatar action passthrough

## Context

Repo: `/workspaces/3D`. This task is where LobeHub's **chat model** meets our **Empathy Layer**. When LobeHub's chat LLM calls a tool (e.g. `speak`, `gesture`, `emote`) declared in the plugin manifest, that tool-call must cross the iframe boundary and hit [agent-protocol](../../src/agent-protocol.js), which fans out to [AgentAvatar](../../src/agent-avatar.js) and produces embodied behavior — speaking with lip-sync hints, gesturing, blending emotions.

Conversely, when the avatar takes its own initiative (a skill emits `SKILL_DONE`, a validation finishes, the avatar signs an action onchain via ERC-8004), that event must surface back into the LobeHub chat transcript so the user sees **what the avatar did**, not just what the chat model said.

Prerequisites:

- [01 plugin manifest](./01-plugin-manifest.md) declares the chat-callable tools.
- [02 handshake](./02-iframe-handshake.md) provides the envelope layer — this task is the semantic mapping inside that envelope.
- [03 identity](./03-host-auth-handoff.md) decides whose wallet signs what.

The [agent-protocol](../../src/agent-protocol.js) bus is already the right shape — every cross-module event goes through it. The full event vocabulary lives in [src/CLAUDE.md](../../src/CLAUDE.md). Reuse it verbatim; do not invent new action types for LobeHub.

## Goal

Wire bidirectional, lossless relay between LobeHub's chat tool-call surface and our protocol bus. Every declared tool call arrives as a `protocol.emit(...)`; every protocol event (filtered appropriately) surfaces back as an `embed:action` envelope the host can render in its transcript.

## Deliverable

1. **New module** `src/embed-action-relay.js`:
   - `class EmbedActionRelay` wired to the bridge from [02](./02-iframe-handshake.md) and the [protocol](../../src/agent-protocol.js) singleton.
   - `attach({ bridge, protocol, identity })` — starts both directions.
   - `detach()` — tears both down.
2. **Inbound mapping** (host tool call → protocol emit):

   | LobeHub tool | ACTION_TYPE | payload shape |
   |---|---|---|
   | `render_agent({ agentId })` | (no emit; triggers `bridge` `host:set-agent` path) | — |
   | `speak({ text, sentiment? })` | `SPEAK` | `{ text, sentiment: clamp(sentiment, -1, 1) }` |
   | `gesture({ name, duration? })` | `GESTURE` | `{ name, duration: duration \|\| 1.5 }` |
   | `emote({ trigger, weight? })` | `EMOTE` | `{ trigger, weight: clamp(weight, 0, 1) }` |
   | `look_at({ target })` | `LOOK_AT` | `{ target }` (validate against `'model'\|'user'\|'camera'`) |

   Every emit must be tagged `sourceSkill: 'lobehub-host'` so the outbound relay filters it out (no loops).

3. **Outbound mapping** (protocol event → host envelope):
   - Subscribe to `protocol.on('*', handler)`.
   - Skip events whose `sourceSkill === 'lobehub-host'` (loop guard).
   - Skip high-frequency internal events (`load-start` and `load-end` are **allowed**; per-frame morph lerps **never** reach the protocol anyway).
   - Translate the canonical action shape into `{ v: 1, ns: '3d-agent', type: 'embed:action', payload: { action: { type, payload, sourceSkill, timestamp, agentId } } }`.
   - Post via the bridge.
4. **Tool-result replies** — when an inbound tool call carried an envelope `id`, post back `{ type: 'embed:tool-result', id, payload: { ok: true, ... } }` once the corresponding protocol event has fired (or after a short timeout with `{ ok: false, error: 'timed-out' }`). This is how LobeHub's chat model closes the tool-call round trip.
5. **Signed actions surface** — when the avatar emits `SIGN` (agent signs an action with its wallet per [03](./03-host-auth-handoff.md) + ERC-8004), the outbound `embed:action` envelope must include `signature`, `address`, and `chainId` from the payload. Downstream task [05](./05-plugin-submission.md) covers the chat-UI representation.

## Audit checklist

- **Loop guard is correct.** Emit → outbound → host echo → inbound → emit → ... is the bug you are preventing. Write a comment explaining exactly how `sourceSkill: 'lobehub-host'` breaks the loop, and which other marker you'd add if that field were overloaded.
- **Sentiment clamp.** `speak` accepts `sentiment` in `[-1, 1]`. Silently clamp and log a `[3d-agent:relay] sentiment out of range` warning. Do **not** reject.
- **Unknown tools.** An inbound tool name not in the table above: respond with `{ ok: false, error: 'unknown-tool' }` — do not throw, do not emit.
- **Empathy Layer preserved.** Every inbound `speak` must hit the protocol — **never** call `AgentAvatar` methods directly. The whole emotion blend depends on the valence scan happening inside [agent-avatar.js](../../src/agent-avatar.js) when it hears `SPEAK`.
- **Ordering.** `perform-skill` → `skill-done` ordering must be preserved in outbound order (not reordered by coalescing).
- **Coalescing.** You may batch outbound `embed:action` envelopes at most 20ms — but never drop. Use a microtask flush, not `setTimeout(0)`.
- **Tool-result timeout.** Default 10s. Configurable via the envelope: `{ ... , meta: { timeoutMs } }`.
- **Identity scope.** Outbound `embed:action` payloads include `agentId`; do **not** strip it. LobeHub may render multiple agents in one thread.

## Constraints

- No new runtime deps.
- This module is pure client-side JS; no server endpoints added. If you need a server round-trip (e.g. for validated signatures), note it in the report — do not add the endpoint here.
- Performance: the outbound `*` listener fires on every protocol event. Must cost <0.1ms per event on a modern laptop. Avoid JSON.stringify in the hot path; let `postMessage` do the structured clone.

## Verification

1. `node --check src/embed-action-relay.js` passes.
2. `npx vite build` succeeds.
3. Ad-hoc test harness (do not commit): a small HTML page that iframes the embed, sends the five tool calls in order, and asserts:
   - Each produces the expected protocol emission (observe via debug global `window.VIEWER.agent_protocol.history`).
   - Each produces an `embed:action` mirror back out (listen in parent).
   - No loop — count of host-originated events in history === count sent.
4. Trigger a skill from inside the avatar (e.g. `protocol.emit({ type: 'speak', payload: { text: 'hi', sentiment: 0.5 }, agentId: ... })` from devtools) and confirm it surfaces back to parent as `embed:action`.
5. Trigger an unknown tool `{ type: 'tool', name: 'nope' }` — confirm `embed:tool-result { ok: false, error: 'unknown-tool' }`.
6. Open the agent log in the parent frame; confirm the action timeline matches [agent-home](../../src/agent-home.js) style (types + timestamps).

## Scope boundaries — do NOT do these

- Do **not** implement the plugin manifest (task [01](./01-plugin-manifest.md)).
- Do **not** rewrite the handshake envelope from [02](./02-iframe-handshake.md) — extend it only with the two new message types: `embed:tool-result` (outbound), and interpretation of `host:action` (inbound). Keep diffs tight.
- Do **not** change the Empathy Layer decay rates or stimulus rules in [src/agent-avatar.js](../../src/agent-avatar.js). Relay into the existing contract.
- Do **not** add new `ACTION_TYPES` to [src/agent-protocol.js](../../src/agent-protocol.js). The current vocabulary is sufficient.
- Do **not** submit to marketplace (task [05](./05-plugin-submission.md)).

## Files off-limits

- `src/agent-protocol.js` — do not extend
- `src/agent-avatar.js` — do not touch
- `public/.well-known/lobehub-plugin.json` — owned by [01](./01-plugin-manifest.md)
- `src/embed-host-bridge.js` — owned by [02](./02-iframe-handshake.md). You may read its `postToHost` surface; do not refactor it.

## Reporting

- New file `src/embed-action-relay.js` — line count, exported symbols
- Exact additions to bridge or embed page (file:line ranges)
- Mapping table above — confirmed implemented, any deviations flagged
- Loop-guard comment pasted into the report
- Verification results for all 6 verification steps above
- `node --check` + `vite build` results
- `TODO(lobehub-spec)` flags if any
- Any unrelated bugs noticed — note, don't fix
