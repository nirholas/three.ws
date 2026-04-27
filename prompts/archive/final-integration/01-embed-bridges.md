# 01 — Embed Host + Action Bridges

## Context

The `<agent-3d>` web component is the sole distribution channel for the three.ws product. It's embedded inside third-party sites (Claude.ai artifacts, LobeHub plugins, customer pages). When an agent lives inside an iframe, the host page has no way to talk to it and vice versa — you can't tell the agent to speak, change avatar, or react to chat messages. You also can't hear the agent's events (skill calls, action logs, state changes) from the parent.

Sprint-100 mapped two bridge modules to fill this gap:

- `src/embed-host-bridge.js` — iframe ↔ parent `postMessage` transport. Handshake, origin check, request/response routing.
- `src/embed-action-bridge.js` — translates bridge messages into `AgentProtocol` events on the agent side and back out on the parent side.

**Neither file was ever written.** The [lobehub-plugin/](../../lobehub-plugin/) already assumes these exist — `AgentBridge` in `lobehub-plugin/src/bridge.ts` calls `postMessage` with a schema that needs a matching receiver on the `<agent-3d>` side. Ship both files.

## Goal

Build a production-grade bidirectional bridge between a host page and an embedded `<agent-3d>` instance. Every action the agent can do through `AgentProtocol` must be reachable from the host; every event the agent emits should be observable (with consent) by the host.

## Files you own

Create:

- `src/embed-host-bridge.js`
- `src/embed-action-bridge.js`

Edit (inside uniquely-named anchor only):

- `src/element.js` — add a single anchor block `<!-- BEGIN:EMBED_BRIDGES --> ... <!-- END:EMBED_BRIDGES -->` near the end of the `connectedCallback` / mount path. Wire both bridges in when the element mounts inside an iframe. **Do not edit anything outside that anchor.**

## Files read-only

- `src/agent-protocol.js` — learn the `ACTION_TYPES` set.
- `src/agent-avatar.js` — learn what actions the performer honors.
- `lobehub-plugin/src/bridge.ts` — reference for the wire protocol the plugin side already expects.
- `specs/EMBED_SPEC.md` — the embed contract.

## Wire protocol

Use `postMessage` with a structured envelope. Every message MUST include:

```js
{
  v: 1,                // protocol version
  source: 'agent-3d',  // or 'agent-host'
  id: 'uuid-v4',       // unique per request
  inReplyTo: 'uuid',   // present on responses only
  kind: 'request' | 'response' | 'event',
  op: 'speak' | 'gesture' | 'emote' | 'look' | 'setAgent' | 'ping' | 'ready' | ...,
  payload: { ... }     // op-specific
}
```

Handshake:

- Child (`agent-3d`) posts `{ kind: 'event', op: 'ready', payload: { agentId, capabilities: [...] } }` once mounted.
- Parent responds with `{ kind: 'request', op: 'ping' }`; child replies `{ kind: 'response', op: 'pong', inReplyTo }`. That round-trip confirms both sides.

Origin security:

- Respect the agent manifest's `policy.origins` allowlist (already parsed by `src/element.js:originAllowed`). Reject any `postMessage` whose `event.origin` is not on the allowlist.
- On the parent side, accept messages only from `event.source === iframe.contentWindow`.

Timeouts & retries:

- Requests carry a 10s timeout. If no response, reject with `TimeoutError`.
- No automatic retries — the host decides.

Backpressure:

- Queue outgoing requests if handshake is not yet complete. Flush on `ready`.
- Drop events (never buffer them indefinitely) if no listener — cap at 256 queued events to prevent memory runaway.

## Host bridge surface (`src/embed-host-bridge.js`)

Export a class `EmbedHostBridge` with:

```js
new EmbedHostBridge({ iframe, agentId, allowedOrigin })
  .ready: Promise<{ agentId, capabilities }>
  .speak(text, opts?): Promise<void>
  .gesture(name): Promise<void>
  .emote({ trigger, weight }): Promise<void>
  .look({ target }): Promise<void>
  .setAgent(nextAgentId): Promise<void>
  .on(event, handler): unsubscribe  // 'action', 'state', 'error'
  .destroy(): void
```

Internally: one `window.addEventListener('message', …)` registered on construction, removed on destroy. All outgoing calls resolve via `inReplyTo` map.

## Action bridge surface (`src/embed-action-bridge.js`)

Export a class `EmbedActionBridge` that lives **inside** the `<agent-3d>` element. It:

1. Subscribes to `window.addEventListener('message', …)` filtered to requests that pass the origin allowlist.
2. Translates each request into one or more `AgentProtocol.emit(...)` calls using the canonical `ACTION_TYPES`.
3. For each action emitted by the agent (subscribe to `protocol.on('action', …)`), echoes it out as a `kind: 'event'` message if the host has subscribed (honor an explicit `subscribe` request to opt-in; do NOT leak actions by default).
4. Translates protocol errors into `kind: 'event', op: 'error', payload: { code, message }`.

Constructor:

```js
new EmbedActionBridge({ protocol, avatar, manifest, window: win })
  .start(): void
  .stop(): void
```

Must not mutate the protocol bus beyond adding listeners. Must clean up on `stop()`.

## Element wiring (`src/element.js`)

Inside the anchor block `EMBED_BRIDGES`, at the tail of the mount path (after `runtime` + `sceneController` + `avatar` are all set up), add:

```js
// BEGIN:EMBED_BRIDGES
import { EmbedActionBridge } from './embed-action-bridge.js';

if (window !== window.parent) {
	this._embedBridge = new EmbedActionBridge({
		protocol: this._protocol,
		avatar: this._avatar,
		manifest: this._manifest,
		window,
	});
	this._embedBridge.start();
}
// END:EMBED_BRIDGES
```

Also add a matching `this._embedBridge?.stop()` call inside the existing `disconnectedCallback`, still within the anchor block. The import line belongs outside the `connectedCallback` function — place it inside the anchor block near the existing imports at top of file (use a second anchor `EMBED_BRIDGES_IMPORT` if cleaner).

Do not import `EmbedHostBridge` here — that's the parent-page side and is consumed externally (from `lobehub-plugin/src/bridge.ts` et al.).

## Deliverables checklist

- [ ] `src/embed-host-bridge.js` created, ~150–250 LOC, JSDoc typed, class `EmbedHostBridge` exported.
- [ ] `src/embed-action-bridge.js` created, ~150–250 LOC, class `EmbedActionBridge` exported.
- [ ] `src/element.js` has exactly one `BEGIN:EMBED_BRIDGES` / `END:EMBED_BRIDGES` anchor block; no edits outside it.
- [ ] `lobehub-plugin/src/bridge.ts` works against the new wire format (verify by reading — do not edit, that's prompt 05's turf).
- [ ] Handshake, timeout, origin check, subscribe/unsubscribe, error propagation all implemented.
- [ ] No new runtime deps. Use crypto.randomUUID for ids (polyfill only if `typeof crypto.randomUUID !== 'function'`).
- [ ] Prettier pass on all touched files.

## Acceptance

- `node --check src/embed-host-bridge.js` passes.
- `node --check src/embed-action-bridge.js` passes.
- `node --check src/element.js` passes.
- `npm run build` succeeds with no new warnings.
- Manual check: `git grep -n "EMBED_BRIDGES" src/element.js` returns exactly 2 lines (BEGIN + END) for each anchor (import + mount).
- Manual check: `git grep -n "EmbedActionBridge\|EmbedHostBridge" src/ lobehub-plugin/src/` shows both modules referenced.
- Manual sanity: in a browser console at `localhost:3000/agent-embed.html?agent=<id>` inside an iframe, the parent can `postMessage({v:1,source:'agent-host',id:'x',kind:'request',op:'ping'})` and receive a `pong` response.

## Report + archive

Post the report block from `00-README.md`, then run:

```bash
git mv prompts/final-integration/01-embed-bridges.md prompts/archive/final-integration/01-embed-bridges.md
```

Commit with message: `feat(embed): host + action bridges — closes band 5`.
