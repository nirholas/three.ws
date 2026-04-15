# 05-04 — Host ↔ agent `postMessage` protocol

## Why it matters

Layer 5 embeds put the avatar inside a host (Claude Artifact, Lobehub chat, third-party iframe). Once embedded, the host needs a defined way to command the avatar: "speak this line", "play wave", "swap to this skill". Without a documented `postMessage` contract the integration is bespoke and brittle. With it, every host gets the same API.

## Context

- Embed page: [public/agent/embed.html](../../public/agent/embed.html) + loader: [src/element.js](../../src/element.js).
- Protocol bus: [src/agent-protocol.js](../../src/agent-protocol.js).
- Avatar runtime: [src/agent-avatar.js](../../src/agent-avatar.js).
- Existing spec: [specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md).

## What to build

### Versioned message envelope

```json
{ "v": 1, "source": "host" | "agent", "id": "<uuid>", "type": "<event>", "payload": { … } }
```

All messages are JSON-serializable. Always include `v`. The agent ignores messages with `v` it doesn't understand.

### Host → agent messages

| type | payload | behavior |
|---|---|---|
| `init` | `{ originAllowlist?: string[] }` | handshake — agent replies with `ready` |
| `speak` | `{ text, voice?: 'system' }` | emits `speech:say` on the protocol bus |
| `play_animation` | `{ slot: 'wave' | 'nod' | 'shake' | 'think' }` | emits `empathy:<slot>` |
| `set_mood` | `{ mood: 'happy'|'sad'|'neutral'|'surprised' }` | emits `empathy:mood` |
| `resize` | `{ width, height }` | lets the host tell the agent to re-layout (useful inside auto-sizing panels) |
| `dispose` | `{}` | cleans up and emits `ready: false` |

### Agent → host messages

| type | payload | when |
|---|---|---|
| `ready` | `{ agentId, capabilities: string[] }` | once after load |
| `speaking_started` / `speaking_ended` | `{ utteranceId }` | while TTS plays |
| `animation_started` / `animation_ended` | `{ slot }` | per animation |
| `click` | `{ region: 'head'|'body'|'hand' }` | user clicks the avatar (if host enabled) |
| `error` | `{ code, message }` | non-fatal failures |

### Origin handshake

- On `init`, the host includes `originAllowlist` (array of origins permitted to send commands).
- If the frame's parent origin isn't in the list, the agent enters read-only mode: `ready` is sent, but all subsequent host messages are ignored and `error { code: 'origin_not_allowed' }` is returned once.
- If `originAllowlist` is omitted, inherit from the per-agent embed policy ([api/agents/[id]/embed-policy.js](../../api/agents/[id]/embed-policy.js)).

### Library side

Extend [src/element.js](../../src/element.js) / [src/lib.js](../../src/lib.js) so `<agent-3d>` and the iframe bootstrap both expose the same `postMessage` API. The component wraps `window.postMessage` via a typed helper `window.agent3d.post(type, payload)` for same-frame embeds.

### Update the spec

Edit [specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md) to document every message exactly as above. The spec is the source of truth; hosts code against it.

## Out of scope

- Streaming tokens for speech (just the full text is fine for v1).
- Bidirectional RPC with correlation ids / return values (fire-and-forget events only).
- Authentication tokens on the channel (handled by 05-05 capability gating).

## Acceptance

1. Open [public/agent/embed.html](../../public/agent/embed.html) in a test page, post `{ v:1, source:'host', type:'speak', payload:{ text:'hello' } }` → avatar speaks.
2. Post `{ type:'play_animation', payload:{ slot:'wave' } }` → avatar waves, host receives `animation_started` and `animation_ended`.
3. Post from a disallowed origin → `error: origin_not_allowed`, no side effects.
4. Spec file matches the implemented set exactly.
5. `node --check` passes on modified files.
