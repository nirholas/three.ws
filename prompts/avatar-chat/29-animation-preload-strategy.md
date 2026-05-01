# 29 — Animation preload strategy: walk + idle ready before first message

## Status
Gap (detail of prompt 04) — walk and idle clips must be loaded before the first user interaction. This requires hooking into the model load lifecycle correctly, not just calling ensureLoaded() at any point.

## Files
`src/viewer.js` — `load()` method, model-loaded callback
`src/element.js` — `_boot()` sequence

## Background

The Viewer's `load()` method loads the GLB and fires `load-end` on the protocol bus. After that, `animationManager.loadAll()` is called (find where in viewer.js — it may be in the post-load hook). Walk and idle must be in memory before the first `brain:stream` event can fire.

## What to implement

### In viewer.js (or wherever animationManager.loadAll is called)

After `animationManager.loadAll()` completes:
```js
// Explicitly ensure the two avatar-chat clips are hot in memory
await Promise.allSettled([
    this.animationManager.ensureLoaded('idle'),
    this.animationManager.ensureLoaded('walk'),
]);
```

`allSettled` (not `all`) so a missing walk clip doesn't block the rest of boot.

### In element.js (belt-and-suspenders)

After the viewer emits `load-end`, run:
```js
protocol.on(ACTION_TYPES.LOAD_END, async () => {
    const am = this._viewer?.animationManager;
    if (!am) return;
    await Promise.allSettled([
        am.ensureLoaded('idle'),
        am.ensureLoaded('walk'),
    ]);
});
```

### Walk clip is 106kB — acceptable first-load cost

The walk.json clip is 106kB (from the build output). This is fine. It will be served with normal HTTP caching. Subsequent page loads will be cache hits.

### Verify idle defaults to playing

After the model loads, the avatar should be in the `idle` animation. Check whether `animationManager.play('idle')` is called on load. If not, add it after the preload:
```js
am.play('idle');
```

## Verification
Load the page. In the browser's Network panel, confirm `walk.json` and `idle.json` are requested during page load (not on first message send). Send a message — the avatar should walk immediately with no delay.
