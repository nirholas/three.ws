# 04 — Camera capture module (self-contained)

## Why

The selfie → avatar flow starts with a camera capture UI. Today the only entry is a Ready-Player-Me iframe. We need a real `getUserMedia` capture that produces a `Blob` any downstream module can consume.

## Parallel-safety

This prompt ships a self-contained JS module with **no route wiring**. A sibling prompt (07) and/or the existing `/create` route will mount it later. You do NOT edit `src/app.js`, `index.html`, or `vite.config.js`.

## Files you own

- Create: `src/camera-capture.js`
- Create: `src/camera-capture.css`

## Deliverable

`src/camera-capture.js` exports:

```js
export class CameraCapture {
    constructor({ container, onCapture, onCancel, aspect = 1 })
    start()        // request permission, start stream, render UI
    stop()         // teardown; safe to call multiple times
}
```

Behavior:

1. `container` is any element; on `start()`, render inside it: a square preview (`<video autoplay muted playsinline>`), a capture button, a "switch camera" button (mobile), a "use upload instead" link.
2. Request `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 }}})`.
3. On capture, draw current video frame to a square `<canvas>`, convert to JPEG blob at 0.92 quality.
4. Show preview with "retake" / "use this photo" buttons. "Use this photo" calls `onCapture(blob, { width, height, mimeType: 'image/jpeg' })`.
5. On permission-denied or no camera: fall back to `<input type="file" accept="image/*" capture="user">`. File pick also calls `onCapture`.
6. `onCancel()` fires if user backs out before capturing.

Stop must release the MediaStream tracks and remove all listeners.

## CSS

`src/camera-capture.css` — scoped under `.camera-capture-root`. Dark overlay, centered square preview, large capture button. No external fonts, no CSS vars from other modules.

## Constraints

- No framework. Vanilla DOM.
- No new deps.
- Must handle Safari iOS (the `playsinline` attribute + muted video matter).
- Must not throw on SSR (guard `typeof navigator !== 'undefined'` in module-top code).

## Acceptance

- `node --check src/camera-capture.js` passes.
- A tiny test harness page (inline, not committed) confirms: mount → permission prompt → capture → blob logged with plausible byte size.
- `npm run build` clean.

## Report

- Mobile Safari behavior notes (inline + muted).
- The blob size you saw for a typical 1280x1280 JPEG at q=0.92.
- Any permissions / HTTPS gotchas.
