# 47 — JSDoc annotations for all new public methods

## Status
Documentation — the codebase convention (src/CLAUDE.md: "JSDoc for public APIs") requires JSDoc on any method exposed to consumers. Several new public and semi-public methods need annotations.

## File
`src/element.js`

## Methods to annotate

### `enableAvatarChat()`
```js
/**
 * Enable the inline avatar-in-chat layout.
 * Avatar walks during LLM streaming and shows a thought bubble.
 * This is the default state — only needed to re-enable after `disableAvatarChat()`.
 */
enableAvatarChat() { ... }
```

### `disableAvatarChat()`
```js
/**
 * Disable the inline avatar-in-chat layout.
 * Restores the original bottom-bar chat overlay.
 * Stops any in-progress walk animation and clears the thought bubble.
 */
disableAvatarChat() { ... }
```

### `_startWalkAnimation()` (if still present — otherwise skip)
Internal — no JSDoc needed per convention (`_underscore` = private).

### `_onStreamChunk()`
Internal — no JSDoc needed.

### `_streamToBubble(chunk)`
Internal — but add a one-line comment for the RAF batching behavior:
```js
// Buffers chunk and flushes to DOM on the next animation frame (RAF-batched).
_streamToBubble(chunk) { ... }
```

### `_clearThoughtBubble()`
Internal — no JSDoc needed.

### `_setBusy(busy)` (from prompt 16)
Internal — one-line comment:
```js
// Disables/re-enables the input and updates placeholder during LLM turns.
_setBusy(busy) { ... }
```

## File `src/runtime/index.js`

### `cancel()`
```js
/**
 * Abort the current in-flight LLM request, if any.
 * Resolves the pending `send()` call immediately.
 */
cancel() { ... }
```

## File `src/runtime/providers.js`

### `AnthropicProvider.complete()` — update existing JSDoc

The `complete()` method now accepts `onChunk` and `signal` params. Update the comment:
```js
/**
 * Send a completion request to Anthropic.
 * Streams the response via SSE and calls `onChunk` for each text delta.
 * @param {{ system, messages, tools, onChunk?, signal? }} opts
 * @returns {Promise<{ text, toolCalls, thinking, stopReason }>}
 */
```

## Verification
`grep -n "@param\|@returns\|@type" src/element.js` shows annotations on `enableAvatarChat` and `disableAvatarChat`. No other new public methods are unannotated.
