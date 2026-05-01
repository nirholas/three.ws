# 46 — Update src/CLAUDE.md: protocol vocabulary and new methods

## Status
Documentation — `src/CLAUDE.md` is the canonical internal reference for developers working in this repo. It needs updates for the avatar-chat feature.

## File
`src/CLAUDE.md`

## Changes needed

### 1 — Protocol bus vocabulary table

Add two rows to the table in "The protocol bus — event vocabulary":

| Type | Payload | Emitted by | Consumed by |
|---|---|---|---|
| *(add)* `brain:stream` (Runtime EventTarget only, not protocol bus) | `{ chunk: string }` | `runtime/_loop()` via `onChunk` callback | `element.js` (bubble streaming, walk animation, chat live text) |
| *(add)* `skill:tool-start` (Runtime EventTarget only) | `{ tool: string, args: object }` | `runtime/_loop()` before tool dispatch | `element.js` (walk start, bubble tool label) |

Note clearly that these are **Runtime EventTarget events** (listened on the `<agent-3d>` host element via `addEventListener`), not protocol bus actions (`protocol.emit()`). This distinction matters for skill authors.

### 2 — Web component boundary section

Add to the `element.js` entry:

> **Avatar-chat mode** (default on): vertical chrome layout with `.avatar-anchor` transparent window. Thought bubble appears above the anchor. Walk animation (`walk` clip) plays during `brain:stream` events. Disabled via `avatar-chat="off"` attribute. New public methods: `enableAvatarChat()`, `disableAvatarChat()`.

### 3 — What's half-built section

Remove or update any entries that are now fully built. Add:

> - `avatar-chat` inline layout — fully wired. Walk clip, thought bubble, stream events all connected. See `prompts/avatar-chat/` for remaining polish items.

### 4 — Gotchas section

Add:
> **`_onStreamChunk()` debounce**: The walk animation uses a 600ms debounce. Calling `_stopWalkAnimation()` directly will interrupt it. Only call `_stopWalkAnimation()` in response to `brain:thinking { thinking: false }` or deliberate teardown.

> **Thought bubble RAF queue**: `_streamToBubble()` buffers chunks and flushes on the next animation frame. Don't read `_thoughtTextEl.textContent` synchronously after calling `_streamToBubble()` — it won't reflect the latest buffer yet.

## Verification
Read through `src/CLAUDE.md`. Every new event, method, and behavior added by the avatar-chat feature is mentioned. No stale "half-built" entries referring to things that are now done.
