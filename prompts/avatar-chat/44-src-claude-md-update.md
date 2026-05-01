# 44 — Update src/CLAUDE.md: protocol vocabulary and new methods

## Status
Required — src/CLAUDE.md is the authoritative reference for agents working in the src/ directory. It must reflect all changes made by this feature.

## File
`src/CLAUDE.md`

## Changes required

### 1 — Protocol bus event vocabulary table

Add two rows to the "The protocol bus — event vocabulary" table:

| Type | Payload | Emitted by | Consumed by |
|---|---|---|---|
| `brain:stream` | `{ chunk: string }` | runtime `_loop()` via Runtime EventTarget | element.js (`_streamToBubble`, `_onStreamChunk`, re-dispatched to host) |
| `skill:tool-start` | `{ tool: string, args: object }` | runtime `_loop()` via Runtime EventTarget | element.js (walk animation, bubble label, re-dispatched to host) |

Note in the table header or a footnote: `brain:stream` and `skill:tool-start` are Runtime EventTarget events (not protocol bus), but they bubble to the host element as composed CustomEvents. They are NOT routed through `protocol.emit()`.

### 2 — New element.js methods section (or update existing)

Under the web component boundary section, add a methods subsection:

```
### Avatar-chat methods (element.js)

- `enableAvatarChat()` — re-enable inline avatar layout + walk + bubble (default on)
- `disableAvatarChat()` — disable to restore bottom-bar layout; removes attribute `avatar-chat="off"`
- `_onStreamChunk()` — start walking; debounces stop by 600ms; respects prefers-reduced-motion
- `_stopWalkAnimation()` — crossfade walk→idle immediately
- `_streamToBubble(chunk)` — append token chunk to bubble, RAF-batched
- `_clearThoughtBubble()` — hide bubble and reset text+buffer
- `_setBusy(busy)` — disable/enable input; sets placeholder and data-busy
```

### 3 — "What's half-built" section

Remove or mark as done: "Runtime `thinking: 'auto'` — limited UX wiring" since streaming now wires up the thought bubble.

Add: "Chat streaming placeholder (prompt 15) — implemented but not tested in all edge cases."

### 4 — Gotchas section

Add:
- **`brain:stream` fires per token** — at 50+ tokens/sec this is frequent. All handlers must be O(1) and RAF-batched. Never do synchronous network or heavy DOM work in a brain:stream handler.
- **Walk animation requires walk+idle clips preloaded** — if `animationManager.isLoaded('walk')` returns false, `_onStreamChunk()` silently skips the walk. Ensure prompt 29 (preload strategy) is implemented.

## Verification
`grep -n "brain:stream\|skill:tool-start\|enableAvatarChat\|avatar-chat" src/CLAUDE.md` returns results in the correct sections.
