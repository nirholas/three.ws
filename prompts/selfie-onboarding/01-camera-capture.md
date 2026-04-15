# Task 01 — Camera capture component

## Why this exists

The selfie flow needs a reliable way to capture a photo in-browser: request permission, show a live preview, let the user take + retake, and emit a `Blob` the next step can upload. Keep it standalone — Avaturn (task 02) and Ready Player Me (task 03) both consume its output.

## Files you own

- Create: `src/onboarding/camera-capture.js` — a small class or factory, no framework.
- Create: `src/onboarding/camera-capture.css` (or append to `style.css` — pick what matches the project; look at how `src/editor/*` styles are loaded).
- Create: a demo harness page `public/onboarding/camera-demo.html` for manual testing.

Do not modify `src/app.js` yet.

## Deliverable

### API

```js
import { CameraCapture } from './onboarding/camera-capture.js';

const cap = new CameraCapture({ container: document.querySelector('#cam') });
await cap.start();              // request permission, show preview
const blob = await cap.capture(); // returns a JPEG Blob (~0.9 quality, ~1024 longest side)
cap.retake();                   // goes back to preview
cap.stop();                     // releases the camera track
cap.on('error', (err) => {});   // emits CameraError with .code in {'permission', 'no-device', 'insecure-context', 'unknown'}
```

Expose a DOM event too: `cap.addEventListener('photo', (e) => e.detail.blob)`.

### Preview UX

- Fill the container. Center-crop square by default (the downstream SDKs want a portrait-orientation face shot).
- Front camera preferred (`facingMode: 'user'`). Flip the preview horizontally so the selfie feels like a mirror. The emitted blob is **not** mirrored — use a separate canvas for the final draw.
- Shutter button is a single 64×64 circle at the bottom. On click: flash overlay for 120ms, then show the captured frame full-bleed with `Retake` and `Use this photo` buttons.
- On `Use this photo`, emit the Blob and freeze the component (caller replaces it with the next step).
- Pre-permission: show a generic "we need your camera to make your avatar" message with a single "Enable camera" button.

### Permissions / failure states

- Insecure context (http on non-localhost) → permanent error card explaining HTTPS is required.
- Permission denied → error card with instructions for Chrome/Safari to unblock.
- No camera present → error card with a "upload a photo instead" button that emits a `fallback` event so the caller can open a file picker.

### Accessibility

- Shutter button has `aria-label="Take photo"`.
- Retake button is focusable and has a visible focus ring.
- Preview `<video>` has `aria-hidden` (it's decorative; the state is conveyed by buttons).

## Constraints

- No new deps. `getUserMedia`, `<video>`, `<canvas>` only.
- Don't run face detection here. The SDKs do it.
- Max captured dimension: 1024px on the longer side (resize before emit). Quality 0.9 JPEG.
- Don't leak the camera track. `stop()` must release it; also release on page unload via a `beforeunload` listener the class adds/removes.

## Acceptance test

1. `node --check src/onboarding/camera-capture.js` passes.
2. `npx vite build` succeeds.
3. Open `public/onboarding/camera-demo.html` in Chrome:
   - Click Enable → browser prompts → allow → live preview.
   - Click shutter → freeze frame → Retake returns to preview.
   - Click "Use this photo" → demo page shows the blob size and a `<img>` preview.
4. Repeat in Safari (desktop). Document any workarounds.
5. Toggle Chrome `camera: block` in site settings → permission-denied state renders cleanly.
6. Deny camera at the OS level (System Settings) → `no-device` or similar renders cleanly.

## Reporting

- Resolved blob size and dimensions for a typical capture.
- Browser compatibility matrix (Chrome / Safari / Firefox / mobile Safari / Chrome Android).
- Any jank during `srcObject` tear-down and how it was handled.
