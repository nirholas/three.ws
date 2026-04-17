# 23 — Chat-to-agent action passthrough bridge

## Why

When the host sends `host.chat.message` (via the postMessage bridge), the agent should react — speak, emote, change pose. Today there's no relay between the bridge's incoming events and the agent's action protocol.

## Parallel-safety

Pure glue module. Imports from [src/agent-protocol.js](../../src/agent-protocol.js) and listens to (not imports) `src/embed-host-bridge.js` via the shared EventTarget API (string event names, no tight coupling).

## Files you own

- Create: `src/embed-action-bridge.js`

## Read first

- [src/agent-protocol.js](../../src/agent-protocol.js) — `ACTION_TYPES`, `protocol.emit()`, handlers.
- [specs/EMBED_HOST_PROTOCOL.md](../../specs/EMBED_HOST_PROTOCOL.md) if sibling prompt 15 has produced it — otherwise rely on the duck-typed events `host.chat.message`, `host.action`, `host.theme`.

## Deliverable

```js
export class EmbedActionBridge {
    constructor({ bridge, protocol })
    // bridge: an EmbedHostBridge-like EventTarget.
    // protocol: the agent protocol singleton (src/agent-protocol.js default export).
    start()
    stop()
}
```

Event map:

| Host event | Translation to agent protocol |
|---|---|
| `host.chat.message {role:'user',text}` | `protocol.emit(ACTION_TYPES.SPEAK_TO_AGENT, { text })` |
| `host.chat.message {role:'assistant',text}` | `protocol.emit(ACTION_TYPES.AGENT_SPEAK, { text })` + optional TTS trigger |
| `host.action {action:'emote.wave'}` | `protocol.emit(ACTION_TYPES.PLAY_ANIMATION, { clip: 'Wave' })` |
| `host.action {action:'emote.*'}` | generic animation trigger with the suffix |
| `host.action {action:'speak', args:{text}}` | `protocol.emit(ACTION_TYPES.AGENT_SPEAK, { text })` |
| `host.theme {mode}` | `document.body.dataset.theme = mode` |

Reverse (agent → host):
- When `protocol` emits `AGENT_EVENT` / `MEMORY_UPDATED` / `EMOTION_CHANGED` → `bridge.send('embed.event', { event, data })`.

Unknown events logged once at debug level, not propagated.

## Constraints

- Don't hardcode `ACTION_TYPES` strings — import the actual constants.
- Don't throw on malformed host events — log + ignore.
- No new deps.

## Acceptance

- `node --check` clean.
- `npm run build` clean.
- Scratch harness with mocked bridge + protocol: messages translate in both directions.

## Report

- List of `ACTION_TYPES` values you mapped (and any that had no clear translation).
- Whether TTS auto-fires on assistant messages (yes/no + rationale).
