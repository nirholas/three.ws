# 04 — Preload walk and idle animation clips on boot

## Status
Gap — `AnimationManager.ensureLoaded()` fetches clips lazily on first play. If `walk` hasn't been fetched yet when the first `brain:stream` fires, `playClipByName('walk')` logs a warning and skips. Same risk for returning to `idle`.

## Files
`src/runtime/scene.js` — `SceneController`
`src/element.js` — boot sequence around line 993

## What to do

In `SceneController` (or wherever the viewer's `animationManager.loadAll()` is called after model load), ensure `walk` and `idle` are among the first clips resolved. The `AnimationManager` already supports parallel loading via `loadAll()` — this is just about ensuring these two are loaded before the first user message is sent.

**Option A (preferred):** After `animationManager.loadAll()` completes, explicitly call:
```js
await Promise.all([
    animationManager.ensureLoaded('idle'),
    animationManager.ensureLoaded('walk'),
]);
```
Place this in `Viewer.load()` or in the post-load hook in `element.js` after `agent:ready` fires.

**Option B (fallback):** In `_onStreamChunk()` in `element.js`, if `walk` isn't loaded yet, skip starting the animation rather than showing a console warning. Change `playClipByName` to check `viewer.animationManager.isLoaded('walk')` first.

Use Option A — it's cleaner. Option B is a safety net only.

## Verification
Add `console.time('walk-ready')` before the preload and `console.timeEnd` after. Confirm it completes within 500ms of boot. Send a message immediately after page load — the avatar should walk on the first response.
