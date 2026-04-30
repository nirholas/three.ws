# Task: Add rate limiting to agent-protocol.js to prevent runaway skill loops

## Context

The project is three.ws — a platform for 3D AI agents.

The repo is at `/workspaces/3D-Agent`.

**What exists:**

- `src/agent-protocol.js` — The event bus for the agent runtime. Everything communicates via `protocol.emit()` / `protocol.on()`. All events (speak, think, gesture, emote, perform-skill, skill-done, etc.) flow through this bus.

- `src/runtime/index.js` — The LLM brain loop. Has `MAX_TOOL_ITERATIONS = 8` to prevent infinite tool loops. But this limit is per-conversation-turn — it doesn't prevent a skill from emitting protocol events that trigger other skills in a cascade.

- `src/CLAUDE.md` explicitly notes: **"No rate limit on `protocol.emit()`. A runaway skill loop will cascade."**

**The problem:** If a skill emits `perform-skill` which triggers another skill that emits `perform-skill` again (or if an error in the emotion layer causes rapid re-emission), the protocol bus can cascade into an infinite event loop. This freezes the browser tab and makes the agent unresponsive.

**The goal:** Add a lightweight rate limiter to `AgentProtocol.emit()` that:
1. Counts events per type over a sliding window (e.g. 100ms)
2. If any event type exceeds a threshold (e.g. 50 events/100ms), stops emitting that event type and fires a `protocol-error` event instead
3. Automatically resets after a cooldown period (e.g. 1 second)

---

## Design

### Rate limiter approach

Use a token bucket or simple counter-per-window per event type:

```js
// In AgentProtocol class
constructor() {
  this._handlers = new Map();
  this._counters = new Map();      // eventType → { count, windowStart }
  this._throttled = new Set();     // event types currently rate-limited
  
  // Limits: max emits per 100ms per event type
  this._limits = {
    'perform-skill': 10,  // skills shouldn't cascade > 10/100ms
    'emote': 20,          // emotion events are high-frequency but bounded
    'speak': 5,           // speaking should be rare
    '*': 100,             // global catch-all
  };
  this._windowMs = 100;
  this._cooldownMs = 1000;
}
```

In `emit(type, payload)`:
```js
emit(type, payload) {
  if (this._isThrottled(type)) {
    console.warn(`[agent-protocol] rate-limited: ${type} — too many events`);
    return; // drop the event
  }
  
  this._recordEmit(type);
  // ... existing dispatch logic ...
}

_isThrottled(type) {
  if (this._throttled.has(type)) return true;
  const counter = this._counters.get(type) || { count: 0, windowStart: Date.now() };
  const now = Date.now();
  
  if (now - counter.windowStart > this._windowMs) {
    // Reset window
    counter.count = 1;
    counter.windowStart = now;
    this._counters.set(type, counter);
    return false;
  }
  
  counter.count++;
  const limit = this._limits[type] ?? this._limits['*'];
  
  if (counter.count > limit) {
    this._throttle(type);
    return true;
  }
  return false;
}

_throttle(type) {
  this._throttled.add(type);
  // Emit a protocol-error so the UI can show something
  // Use a flag to prevent this from itself being rate-limited
  if (type !== 'protocol-error') {
    this._dispatchDirect('protocol-error', {
      code: 'rate_limited',
      eventType: type,
      message: `Event type "${type}" rate-limited — too many emissions in ${this._windowMs}ms`,
    });
  }
  setTimeout(() => {
    this._throttled.delete(type);
    this._counters.delete(type);
  }, this._cooldownMs);
}
```

### Debug mode

Add a `debug` option to the constructor: when `true`, log every emit with a timestamp instead of rate-limiting. Useful for development.

---

## Files to edit

**Edit:**
- `src/agent-protocol.js` — add the rate limiter as described

**Do not touch:**
- Any caller of `protocol.emit()` — the rate limit is transparent to callers
- `src/runtime/index.js` — the `MAX_TOOL_ITERATIONS` limit stays in place as a separate guard

---

## Acceptance criteria

1. Normal agent operation (user sends a message, agent responds, skills fire once) — no events are rate-limited. All 10+ normal events/conversation pass through unthrottled.
2. Simulate a runaway loop: in the browser console, run:
   ```js
   for (let i = 0; i < 200; i++) window.VIEWER.agent_protocol.emit('perform-skill', { skill: 'test' });
   ```
   After 10 events in 100ms, the remaining events are dropped and a `protocol-error` event is fired.
3. After 1 second, `protocol.emit('perform-skill', ...)` works again (cooldown expired).
4. The `protocol-error` event can be subscribed to: `protocol.on('protocol-error', (e) => console.log(e))`.
5. `npx vite build` passes. `node --check src/agent-protocol.js` passes.

## Constraints

- The rate limiter must not add perceptible latency to normal emit() calls — use `Date.now()` (not `performance.now()`) for simplicity.
- No new npm dependencies.
- ESM only. Tabs, 4-wide. Match existing style in `src/agent-protocol.js`.
- The `'*'` global limit is the backstop — per-type limits override it for known types.
- `debug` mode should be settable at runtime: `protocol.debug = true`.
