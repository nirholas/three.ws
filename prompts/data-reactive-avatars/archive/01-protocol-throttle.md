# 01 — Throttle / coalesce the protocol bus for high-frequency events

## Why

`src/agent-protocol.js` has no rate limit on `protocol.emit()` (called out as a gotcha in [src/CLAUDE.md](../../src/CLAUDE.md)). Once we wire avatars to live feeds (pump.fun firehose, websocket APIs, etc.), a runaway producer will twitch the avatar — `gesture` and `emote` events will queue faster than the empathy layer can decay them, producing visible jitter and burning CPU on morph-target traversal every frame.

This prompt fixes that without changing the public API of the bus. After it ships, downstream skills can fire as fast as they want and the avatar still looks composed.

## Real, no-mock requirements

- The throttle uses real `performance.now()` / `Date.now()` and the real protocol event loop. No fake timers in production code.
- Tests must subscribe to a real `AgentProtocol` instance and verify event delivery counts under real timing (use `vi.useFakeTimers()` only inside the test, not in production code).

## Scope

Modify `src/agent-protocol.js`:

1. Add an internal coalescing layer keyed by event `type`. Default policy:
   - `gesture`: **leading-edge** throttle, min 600 ms between fires (a gesture clip is one-shot and ~0.5–1.0 s; firing more often than that is wasted).
   - `emote`: **coalesce by trigger** within a 150 ms window — when multiple `emote` events with the same `payload.trigger` arrive in the window, emit one with the **max** weight seen.
   - `look-at`: trailing-edge debounce, 100 ms (only the latest target matters).
   - `speak`, `think`, `skill-done`, `skill-error`, `remember`, `sign`, `load-start`, `load-end`, `validate`, `presence`: **pass through unchanged** (these are semantic, not animation-driving).
2. Expose `protocol.setThrottlePolicy(type, policy)` so skills can override per-instance, where `policy` is one of:
   - `{ mode: 'passthrough' }`
   - `{ mode: 'throttle', leading: true, intervalMs: number }`
   - `{ mode: 'debounce', intervalMs: number }`
   - `{ mode: 'coalesce', windowMs: number, key: (payload) => string, merge: (a, b) => payload }`
3. Preserve the existing `history` ring buffer behavior — record the **emitted** events (post-throttle), not the dropped ones, but keep a separate `protocol.droppedCount(type)` counter for debug.
4. The wildcard subscription (`protocol.on('*', fn)`) must still see only emitted events.

## Out of scope

- Changing event payloads or the `ACTION_TYPES` list.
- Adding new event types.
- Touching `agent-avatar.js` empathy decay (the throttle policy is what tames it).

## Verification (must all pass before archiving)

- `pnpm test` (or `npm test`) — add a new test file `src/agent-protocol.test.js` (or extend the existing one if present) covering: throttle leading-edge, debounce trailing, coalesce-by-key with merged max-weight, passthrough for `speak`, `setThrottlePolicy` override, `droppedCount` accuracy, wildcard sees only emitted.
- `npm run lint` — clean.
- Manual smoke: in a browser console with `<agent-3d>` mounted, run a 1 kHz `for (let i = 0; i < 1000; i++) window.VIEWER.agent_protocol.emit('emote', { trigger: 'celebration', weight: Math.random() })` — avatar must not stutter; `droppedCount('emote')` must reflect the suppressed events.

## When done

1. Update the **Gotchas** section of [src/CLAUDE.md](../../src/CLAUDE.md): replace the "No rate limit on `protocol.emit()`" bullet with a note pointing to the throttle policy and how to override.
2. `git mv prompts/data-reactive-avatars/01-protocol-throttle.md prompts/data-reactive-avatars/archive/01-protocol-throttle.md`.
