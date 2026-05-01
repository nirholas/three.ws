# 46 — JSDoc annotations for all new public methods

## Status
Required — per src/CLAUDE.md: "JSDoc for public APIs." All new public methods added by this feature need JSDoc.

## File
`src/element.js`

## Methods requiring JSDoc

```js
/**
 * Enable the inline avatar-in-chat layout.
 * The avatar canvas is visible through a transparent window between the chat
 * history and the input bar. The avatar walks during LLM streaming and shows
 * a thought bubble with streaming text above its head.
 * This is the default state. Call to re-enable after `disableAvatarChat()`.
 */
enableAvatarChat() { ... }

/**
 * Disable the inline avatar-in-chat layout and restore the original
 * bottom-bar chat layout (messages left, input right, avatar in background).
 * Walk animation and thought bubble will not fire while disabled.
 * Equivalent to setting the `avatar-chat="off"` attribute.
 */
disableAvatarChat() { ... }
```

## Private methods (no JSDoc needed per convention, but add a one-line comment if the logic is non-obvious)

```js
// Walk animation: debounced — keeps walking as long as chunks arrive within 600ms of each other
_onStreamChunk() { ... }

// Crossfade walk→idle; safe to call even if not walking
_stopWalkAnimation() { ... }

// RAF-batched bubble text update; clears at sentence boundaries
_streamToBubble(chunk) { ... }

// Hides bubble, clears buffer, cancels pending RAF
_clearThoughtBubble() { ... }

// Disables input and updates placeholder during LLM processing
_setBusy(busy) { ... }
```

## Verification
Run `npx jsdoc src/element.js --dry-run` (if JSDoc is installed) and confirm no parse errors on the new methods. Or simply do a visual review that the JSDoc is correctly formatted above the method signature.
