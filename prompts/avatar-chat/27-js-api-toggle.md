# 27 — JS API methods: enableAvatarChat() / disableAvatarChat()

## Status
Enhancement — while `setAttribute('avatar-chat', 'off')` works, it's not discoverable. Public methods make the API ergonomic for JS consumers.

## File
`src/element.js` — public API section (near `wave()`, `lookAt()`, `playClip()`)

## What to add

```js
/**
 * Enable the inline avatar-in-chat mode (thought bubble + walk animation).
 * This is the default state — call this to re-enable after disabling.
 */
enableAvatarChat() {
    this.removeAttribute('avatar-chat');
}

/**
 * Disable the inline avatar-in-chat mode.
 * Restores the original bottom-bar chat layout.
 * Avatar walk animation and thought bubble will not fire while disabled.
 */
disableAvatarChat() {
    this.setAttribute('avatar-chat', 'off');
    this._stopWalkAnimation();
    this._clearThoughtBubble();
}
```

Place these after `playClip()` (line ~1679 in the current file).

## Verification
```js
const el = document.querySelector('agent-3d');
el.disableAvatarChat();
// Layout reverts to bottom-bar. Walk and bubble stop.
el.enableAvatarChat();
// Layout returns to vertical column.
```
