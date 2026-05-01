# 40 — lib.js export surface: expose new avatar-chat API

## Status
Gap — `src/lib.js` is the CDN library export surface. New public methods and CSS custom properties added by the avatar-chat feature should be reflected there if they change the public API surface.

## File
`src/lib.js`

## What to check

Open `src/lib.js`. Verify it exports:
- `Agent3DElement` (the custom element class, or the element registration)
- Any utility functions exposed to library consumers

The `enableAvatarChat()` and `disableAvatarChat()` methods (prompt 27) are on the element instance — they're accessible via `document.querySelector('agent-3d').enableAvatarChat()`. No explicit lib.js change needed for instance methods.

However, if lib.js exports TypeScript-style JSDoc typedef comments or an API surface description, add:

```js
/**
 * @typedef {Object} AvatarChatOptions
 * @property {'off'|undefined} avatarChat - Set to 'off' to disable inline avatar layout
 */
```

And add JSDoc to the element class:
```js
/**
 * Enable the inline avatar-in-chat layout.
 * Avatar walks during LLM streaming, thought bubble shows response text.
 * @returns {void}
 */
enableAvatarChat() { ... }

/**
 * Disable the inline avatar-in-chat layout and restore bottom-bar chat.
 * @returns {void}
 */
disableAvatarChat() { ... }
```

## What NOT to change

Do not add `brain:stream` to any export — it's an internal Runtime EventTarget event that bubbles through the host element as a composed CustomEvent. External consumers listen on the element:
```js
element.addEventListener('brain:stream', (e) => console.log(e.detail.chunk));
```
This already works without lib.js changes.

## Verification
Build the library (`npm run dev:lib` or `npm run build`). Confirm no new exports are accidentally omitted or duplicated.
