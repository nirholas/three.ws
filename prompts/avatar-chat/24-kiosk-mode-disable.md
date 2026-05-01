# 24 — Kiosk mode: fully disable avatar-chat features

## Status
Gap — kiosk mode hides all chat UI chrome but the avatar-chat JS logic (walk animation, thought bubble) still runs. The thought bubble element doesn't exist in kiosk mode (created inside `if (!this.hasAttribute('kiosk'))`), so `_thoughtBubbleEl` is null, which is fine. But `_onStreamChunk()` still triggers walk animations.

This is mostly harmless but kiosk mode should be a clean "no chat interaction" mode.

## File
`src/element.js`

## What to do

In `_onStreamChunk()`, also check for kiosk mode:
```js
_onStreamChunk() {
    if (!this._scene) return;
    if (this.getAttribute('avatar-chat') === 'off') return;
    if (this.hasAttribute('kiosk')) return;
    ...
}
```

Same check in `_stopWalkAnimation()` is not needed (stopping is always safe).

Also ensure `_setBusy()` (from prompt 16) is a no-op in kiosk mode:
```js
_setBusy(busy) {
    if (!this._inputEl) return; // null in kiosk mode — already safe
    ...
}
```

## Verification
Add `kiosk` attribute. Send a message via `element.say('hi')`. Avatar should NOT walk (kiosk is a display mode, not an interaction mode).
