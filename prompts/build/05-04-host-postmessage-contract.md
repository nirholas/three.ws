# 05-04 — Versioned host ↔ agent postMessage contract

**Pillar 5 — Host embed.**

## Why it matters

The Claude Artifact runtime (`05-01`), Lobehub plugin (`05-03`), and the existing `/agent/:id/embed` iframe all rely on `postMessage`. We currently have a shape that's accreted ad-hoc and isn't documented anywhere canonical. Before more hosts land, freeze a **versioned** protocol so embedders can rely on it.

## What to build

A spec file + a tiny helper library used by the agent iframe AND any host that wants to drive it.

## Read these first

| File | Why |
|:---|:---|
| [public/agent/embed.html](../../public/agent/embed.html) | Current message loop. |
| `api/agents/[id]/artifact.js` (from 05-01) | Artifact message loop. |
| `api/agents/[id]/lobe-ui.js` (from 05-03) | Lobehub message loop. |
| [specs/](../../specs/) | Where the spec file goes. |
| [src/agent-protocol.js](../../src/agent-protocol.js) | Internal event vocabulary — the outer postMessage protocol mirrors this. |

## Build this

### 1. Spec — `specs/EMBED_POSTMESSAGE.md`

Document:

- **Envelope:** every message has `{ __agent: <agentId>, v: 1, type, payload }`. Reject messages missing `__agent` or where `__agent` ≠ our agent id.
- **Inbound types (host → agent):**
  - `speak` `{ text: string, sentiment?: number }` — agent logs + nudges emotion (no TTS in sandbox contexts).
  - `emote` `{ trigger: string, weight: number }` — add to emotion blend (clamped 0..1).
  - `gesture` `{ name: string, duration?: number }` — one-shot clip.
  - `look-at` `{ target: 'user' | 'camera' | 'model' }` — reorient head.
  - `load-avatar` `{ avatarId: string }` — swap the loaded GLB (only if same owner; otherwise ignored).
  - `ping` `{}` — responds with `pong`.
- **Outbound types (agent → host):**
  - `ready` `{ name: string, avatar_id: string, chain?: { id, token_id } }`
  - `error` `{ message: string, code?: string }`
  - `state` `{ emotion: { concern, celebration, patience, curiosity, empathy }, currentClip?: string }` — throttled to 10 Hz.
  - `action-done` `{ type, ok: boolean, detail? }` — ack for inbound messages.
  - `pong` `{}` — response to ping.
- **Origin allowlist:** `https://claude.ai`, `https://*.lobehub.com`, `https://3dagent.vercel.app`, and the embedding page's origin itself. Anything else → log + ignore.
- **Version negotiation:** `v` defaults to 1. If host sends `v: 2` we don't know, reply with `{ type: 'error', code: 'unsupported_version' }` and ignore the payload.

### 2. Helper — `src/lib/embed-bridge.js`

Two exports:

```js
// Used INSIDE agent iframe
export function createAgentBridge({ agentId, onMessage, allowedOrigins }) { /* returns { post, destroy } */ }

// Used by hosts (including our own test harness) to drive an agent iframe
export function createHostBridge({ frame, agentId, onMessage }) { /* returns { emote, gesture, speak, lookAt, ping, destroy } */ }
```

Both:
- Filter messages by `__agent` + origin.
- Drop malformed payloads silently (don't throw on untrusted input).
- Auto-reply to `ping`.
- Throttle outbound `state` to 10 Hz via `requestAnimationFrame`.

### 3. Adopt the bridge

Replace ad-hoc listeners in:
- [public/agent/embed.html](../../public/agent/embed.html)
- `api/agents/[id]/artifact.js` inlined boot script (inline a minified copy of the bridge — can't import cross-origin from the artifact).
- `api/agents/[id]/lobe-ui.js`

### 4. Test harness

`public/preview/embed-tester.html` — a page that loads an agent embed and has buttons for every inbound type. Used for manual testing + documentation screenshots.

## Out of scope

- Do not add cryptographic signing of messages (future; mention in the spec as "reserved for v2 — tag: `sig`").
- Do not add message persistence (fire-and-forget).
- Do not add SharedArrayBuffer / BroadcastChannel alternatives.
- Do not rewrite the internal `src/agent-protocol.js` — this is strictly the external contract.

## Deliverables

**New:**
- `specs/EMBED_POSTMESSAGE.md`
- `src/lib/embed-bridge.js`
- `public/preview/embed-tester.html`

**Modified:**
- [public/agent/embed.html](../../public/agent/embed.html) — adopt bridge.
- `api/agents/[id]/artifact.js` (05-01) — inline the bridge code.
- `api/agents/[id]/lobe-ui.js` (05-03) — adopt bridge.

## Acceptance

- [ ] Spec is clear enough that a stranger could implement a host in a different language.
- [ ] Test harness fires every inbound type and sees expected reactions.
- [ ] Cross-origin messages from non-allowlisted origins are silently dropped.
- [ ] Messages missing `__agent` are dropped.
- [ ] `ping` → `pong` round-trip works.
- [ ] `state` outbound throttled to ≤10 Hz.
- [ ] `npm run build` passes.

## Test plan

1. Open `public/preview/embed-tester.html?agent=<id>` → buttons fire every inbound type.
2. Watch devtools messages panel: every action → `action-done` ack.
3. Post from devtools with bogus `__agent` → ignored.
4. Set unsupported `v: 99` → agent replies `error: unsupported_version`.
5. Origin spoofing: open tester from `file://` origin → messages ignored, console logs the drop.
