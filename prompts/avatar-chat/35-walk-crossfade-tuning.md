# 35 — Walk ↔ idle crossfade timing tuning

## Status
Polish — the walk↔idle transitions use `fade_ms: 300` (walk start) and `fade_ms: 500` (idle return). These are reasonable defaults but may feel abrupt or floaty depending on the model and walk clip. Tune for smoothness.

## File
`src/element.js` — `_onStreamChunk()` and `_stopWalkAnimation()`

## Current values
```js
this._scene.playClipByName('walk', { loop: true, fade_ms: 300 });
// ...
this._scene?.playClipByName('idle', { loop: true, fade_ms: 500 });
```

## Tuning guidelines

**Walk start (idle → walk):**
- Too short (< 150ms): Jarring snap into walk. Avatar pops unnaturally.
- Too long (> 600ms): Walk feels sluggish to start, avatar still looks idle while brain:stream is active.
- Sweet spot: **250–350ms**. Current 300ms is good — verify visually.

**Walk end (walk → idle):**
- Too short (< 300ms): Avatar snaps back to idle, looks mechanical.
- Too long (> 800ms): Walk continues visibly after the thought bubble is gone, feels disconnected.
- Sweet spot: **400–600ms**. Current 500ms is good — verify visually.

**Debounce timer (time after last chunk before stopping):**
- Current: 600ms
- If walk stops too early (mid-sentence): increase to 800ms
- If walk lingers after response ends: decrease to 400ms
- Sweet spot: **500–700ms**

## What to do

1. Load the app with a test avatar
2. Send a short message (< 20 words) — verify walk starts promptly and ends cleanly
3. Send a long message (> 100 words with tool calls) — verify walk stays active throughout
4. Adjust the three values above if needed
5. Document the final chosen values as a comment in `_onStreamChunk()`:
```js
// fade_ms: 300ms idle→walk, 500ms walk→idle, 600ms debounce after last chunk
```

## No code changes required unless values need adjustment. This is a tuning/verification step.
