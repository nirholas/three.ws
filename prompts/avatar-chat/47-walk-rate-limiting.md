# 47 — Rate-limit walk animation start calls

## Status
Performance/correctness — `_onStreamChunk()` is called on every `brain:stream` event, which fires 10-50 times per second. Each call does `clearTimeout` + `setTimeout` (cheap) but also calls `this._scene.playClipByName('walk', ...)` on the first chunk. The AnimationManager's `crossfadeTo()` is async (lazy loads if needed). Calling it multiple times rapidly could cause issues if the first call hasn't resolved.

## File
`src/element.js` — `_onStreamChunk()`

## Current code
```js
_onStreamChunk() {
    if (!this._scene || this.getAttribute('avatar-chat') === 'off') return;
    if (!this._isWalking) {
        this._isWalking = true;
        this._scene.playClipByName('walk', { loop: true, fade_ms: 300 });
    }
    clearTimeout(this._walkStopDebounce);
    this._walkStopDebounce = setTimeout(() => this._stopWalkAnimation(), 600);
}
```

## Analysis

The `if (!this._isWalking)` guard already prevents `playClipByName` from being called more than once per walk session. `this._isWalking = true` is set synchronously before the async `playClipByName` call. This means subsequent chunks see `_isWalking = true` and skip. This is correct.

The only risk: if `playClipByName` fails (clip not loaded, promise rejects), `_isWalking` stays true and the walk never actually plays. The avatar is stuck in a "walking" state that never started.

## Fix

Handle the promise rejection:
```js
_onStreamChunk() {
    if (!this._scene || this.getAttribute('avatar-chat') === 'off') return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!this._isWalking && !prefersReduced) {
        this._isWalking = true;
        this._scene.playClipByName('walk', { loop: true, fade_ms: 300 })
            .catch(() => {
                // Walk clip unavailable — reset so idle stays
                this._isWalking = false;
            });
    }
    clearTimeout(this._walkStopDebounce);
    this._walkStopDebounce = setTimeout(() => this._stopWalkAnimation(), 600);
}
```

Note: `playClipByName` may not return a Promise in all code paths — check `src/runtime/scene.js`. If it doesn't, wrap defensively: `Promise.resolve(this._scene.playClipByName(...)).catch(...)`.

## Verification
Delete `walk.json` temporarily. Send a message. Avatar should stay idle (no error in console, no stuck walk state). Restore the file — avatar walks normally.
