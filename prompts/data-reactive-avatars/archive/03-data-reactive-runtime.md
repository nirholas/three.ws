# 03 — `data-reactive` runtime helper for skills

## Why

Today a skill that wants to drive avatar movement from a live data source has to hand-roll the WebSocket / SSE / polling loop, classification logic, and protocol emits. We want a single reusable primitive that any skill can import to declaratively wire `data → protocol events`.

This prompt adds `src/runtime/data-reactive.js` as a small, real helper — no skill changes, no UI, no network mocks. Subsequent skills can compose it.

## Real, no-mock requirements

- The helper uses real `EventSource` / `WebSocket` / `fetch`. No fake transports.
- Tests use a real `EventSource` against a real `data:` URL or a real local SSE server stood up in the test (Node's `http` module). No mocked transports.

## Scope

Create `src/runtime/data-reactive.js` exporting:

```js
/**
 * @typedef {Object} ReactiveBinding
 * @property {(event: any) => boolean} match     — predicate run on each event payload
 * @property {(event: any) => Array<{type: string, payload: object}>} emit  — returns protocol events to fire
 */

/**
 * @param {Object} opts
 * @param {AgentProtocol} opts.protocol
 * @param {{ kind: 'sse', url: string } |
 *        { kind: 'ws',  url: string, subscribe?: object|object[] } |
 *        { kind: 'poll', url: string, intervalMs: number, parse?: (resp: Response) => Promise<any[]> }} opts.source
 * @param {ReactiveBinding[]} opts.bindings
 * @param {AbortSignal} [opts.signal]
 * @returns {{ stop: () => void, stats: () => { received: number, emitted: number, errors: number } }}
 */
export function startDataReactive(opts) { /* ... */ }
```

Behavior:

1. **`sse`**: open `new EventSource(url)`. Listen for both default `message` and any named events. JSON-parse the `data` field (skip silently on parse error, increment `errors` stat). For each event, run every binding's `match`; for matches, call `emit` and forward results to `protocol.emit(type, payload)`.
2. **`ws`**: open a real WebSocket. On `open`, send each `subscribe` payload as JSON (if provided). On `message`, parse JSON and run bindings as above. Reconnect with exponential backoff (1 s → 2 s → 4 s → 8 s → cap 30 s) up to 10 attempts; reset on successful `open`.
3. **`poll`**: `setInterval` to `fetch(url)`; default `parse` is `(r) => r.json().then(d => Array.isArray(d) ? d : [d])`. Run bindings on each entry.
4. **`stop`** closes the transport, clears timers, and is idempotent.
5. **`signal`** wires `signal.addEventListener('abort', stop)`.
6. Counters are real numbers, returned by `stats()` — no logging side effects beyond `console.error` for transport errors.

Add `dataReactive: { start: startDataReactive }` to the skill `ctx` exposed by `src/skills/index.js` so skill handlers receive it as `ctx.dataReactive.start({...})`. Update `src/CLAUDE.md`'s "Skill handler context" line accordingly.

## Out of scope

- Built-in classifiers (each skill writes its own bindings).
- A UI.
- Persisting events.

## Verification (must all pass before archiving)

- Add `src/runtime/data-reactive.test.js`:
  - **SSE test**: spin up a local `http.createServer` that streams two real `event: mint\ndata: {...}\n\n` chunks, point `startDataReactive` at it, assert both are emitted to a real `AgentProtocol` instance.
  - **WS test**: spin up a local `ws` server, send two messages, assert reconnect on close.
  - **Poll test**: stand up a local server returning JSON, assert the binding fires on each interval (use `vi.useFakeTimers()` in the test only — production code uses real timers).
  - **Stop**: assert `stop()` releases the transport and stops counters.
- `npm run lint` clean.

## When done

1. Add a one-line entry under "Runtime (LLM brain)" in [src/CLAUDE.md](../../src/CLAUDE.md) for `runtime/data-reactive.js`.
2. `git mv prompts/data-reactive-avatars/03-data-reactive-runtime.md prompts/data-reactive-avatars/archive/03-data-reactive-runtime.md`.
