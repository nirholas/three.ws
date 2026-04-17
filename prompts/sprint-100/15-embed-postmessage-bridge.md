# 15 — Embed postMessage bridge

## Why

Agent running inside a host iframe (Claude, LobeHub, random blog) needs a versioned message bus: host sends chat messages/actions, embed sends back agent events. A well-defined handshake makes the whole host-embed ecosystem stable.

## Parallel-safety

New standalone module. Not wired to the web component yet — sibling prompts connect it.

## Files you own

- Create: `src/embed-host-bridge.js`
- Create: `specs/EMBED_HOST_PROTOCOL.md` — versioned protocol spec.

## Deliverable

### Protocol (v1)

Messages are JSON, always shaped `{ v: 1, type: string, id?: string, payload?: object }`.

**Host → embed:**
- `host.hello` → `{ hostName, hostVersion, hostOrigin, userId?: string, userName?: string }`
- `host.chat.message` → `{ role: 'user'|'assistant', text: string, messageId: string }`
- `host.action` → `{ action: string, args?: object }` (e.g., `'emote.wave'`, `'speak', { text }`)
- `host.theme` → `{ mode: 'dark'|'light' }`

**Embed → host:**
- `embed.ready` → `{ agentId, version, capabilities: string[] }`
- `embed.event` → `{ event: string, data?: object }`
- `embed.error` → `{ code, message }`
- `embed.request` → `{ id, method, params? }` (host can reply with `host.response { id, result|error }`)

### `src/embed-host-bridge.js`

```js
export class EmbedHostBridge extends EventTarget {
    constructor({ allowedOrigins = '*' /* or ['https://claude.ai', ...] */ })
    start()  // adds postMessage listener, sends 'embed.ready' upward to window.parent
    stop()
    send(type, payload)
    request(method, params, { timeout = 5000 } = {}) // returns Promise resolving to result
}
```

Behavior:
- Only messages from `window.parent` matching an allowed origin are processed.
- `addEventListener('host.chat.message', e => ...)` etc — emit a typed CustomEvent per incoming type.
- `request()` assigns an id, waits for matching `host.response`, rejects on timeout.
- Sends `embed.error` on malformed messages.
- Defensive: ignore messages missing `v: 1` or with unknown types (log once, don't crash).

## Spec doc

`specs/EMBED_HOST_PROTOCOL.md` — table of all message types, example payloads, versioning policy (bump `v` when breaking, deprecate gracefully for one minor).

## Constraints

- No new deps.
- Module must be SSR-safe (guard `typeof window !== 'undefined'`).
- No `eval`, no `new Function`.

## Acceptance

- `node --check` clean.
- `npm run build` clean.
- Scratch harness with two iframes (host + embed) exchanges messages correctly; unknown types are ignored.

## Report

- Final list of message types implemented (match the spec).
- Origin-allowlist behavior for `'*'` vs explicit list.
