# 25 — Add STREAM action type to protocol bus

## Status
Gap — `brain:stream` is dispatched by the runtime and re-dispatched by element.js but `ACTION_TYPES` in `agent-protocol.js` doesn't include it. This means skill authors and external protocol listeners can't reference it by a named constant, and the src/CLAUDE.md vocabulary table is incomplete.

## Files
`src/agent-protocol.js`
`src/CLAUDE.md`

## Changes to agent-protocol.js

Add to `ACTION_TYPES`:
```js
export const ACTION_TYPES = {
    // ...existing...
    STREAM: 'brain:stream', // LLM token chunk arriving during streaming response
    TOOL_START: 'skill:tool-start', // tool execution beginning (before result)
};
```

Note: `brain:stream` uses the `brain:` prefix (it's a runtime event, not a protocol bus action) — keep the constant name `STREAM` with value `'brain:stream'` to be consistent with how `THINK` maps to `'think'` in protocol context. However, check if these are actually fired on the protocol bus vs the Runtime EventTarget — if `brain:stream` only flows through the Runtime and host element, it does NOT belong in ACTION_TYPES (which is for the protocol bus). Audit this and only add it to ACTION_TYPES if it's actually emitted on `protocol.emit()`.

If `brain:stream` is only on the Runtime EventTarget (not the protocol bus), add a note to ACTION_TYPES:
```js
// NOTE: 'brain:stream' is a Runtime EventTarget event, not a protocol bus action.
// Listen on the host element: element.addEventListener('brain:stream', handler).
// Skill:tool-start is also Runtime-only.
```

## Changes to src/CLAUDE.md

In the "The protocol bus — event vocabulary" table, add a row:

| `brain:stream` | `{ chunk: string }` | runtime `_loop()` via Runtime EventTarget | element.js (re-dispatched to host as composed event) |

Also add `skill:tool-start`:

| `skill:tool-start` | `{ tool: string, args: object }` | runtime `_loop()` | element.js (walk animation, bubble label) |

## Verification
`grep -n "STREAM\|TOOL_START" src/agent-protocol.js` returns the new constants.
The src/CLAUDE.md table includes both new event types.
