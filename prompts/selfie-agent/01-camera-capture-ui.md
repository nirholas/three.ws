# Task: Build the `/create` camera-capture UI

## Context

Repo: `/workspaces/3D`. A Vite + vanilla JS SPA where the current "create avatar" flow is a single button in [index.html](../../index.html) (id `create-avatar-btn`) that opens the Avaturn iframe via [src/avatar-creator.js](../../src/avatar-creator.js), wired in `setupAvatarCreator()` in [src/app.js](../../src/app.js) around line 402.

We are about to ship the hero demo: take a selfie on a phone, get a personalized 3D avatar in 30 seconds. Step 1 is the capture surface. The Avaturn handoff (step 2), R2 pin + `agent_identities` row (step 3), name/description (step 4), and post-creation scene (step 5) are separate prompts in this series — do not reach into them.

The existing Avaturn modal lives in [src/avatar-creator.js](../../src/avatar-creator.js) and is kept. This task **adds a new route** that replaces the current one-click button as the primary onboarding entry, and falls back to the existing Avaturn modal only for users who pick "skip selfie".

## Goal

Ship a `/create` route (or fullscreen panel — same effect) where a signed-in or anonymous user can:

1. Grant camera permission via `navigator.mediaDevices.getUserMedia`.
2. See a live square preview.
3. Tap a capture button, see the frozen JPEG, decide retake or accept.
4. If permission denied or no camera, fall back to an `<input type="file" accept="image/*" capture="user">` upload.

On accept, the flow hands the `Blob` off to a single exported function `onCaptureReady(blob)` — **do not** call Avaturn from this task. Leave a TODO wired to a named event/callback that prompt 02 will hook into.

## Deliverable

1. **New file: `src/selfie-capture.js`** — class `SelfieCapture` with:
   - `constructor(rootEl, { onCaptureReady })`
   - `mount()` / `unmount()` — idempotent
   - Internal `_startCamera()`, `_stopCamera()`, `_capture()`, `_showReview(blob)`, `_retake()`, `_handleUploadFallback(file)`
   - All `addEventListener` callbacks stored on `this._…` fields so `unmount()` can remove them cleanly (follow the stored-bound-handler pattern used in [src/avatar-creator.js](../../src/avatar-creator.js)).
2. **New file: `public/create.html`** — minimal skeleton (DOCTYPE, meta viewport, single `<div id="create-root">`). Import `../src/selfie-capture.js` via a `<script type="module">` and call `new SelfieCapture(root, { onCaptureReady }).mount()`.
3. **Edit [vercel.json](../../vercel.json)** — add `{ "src": "/create", "dest": "/public/create.html" }` and `{ "src": "/create/", "dest": "/public/create.html" }` above the catch-all `/public/$1` route.
4. **Edit [index.html](../../index.html)** — make `#create-avatar-btn` navigate to `/create` (use an `<a>` or plain `window.location = '/create'` click handler). Keep the existing in-page Avaturn modal reachable via a "Skip — use the editor" link inside `/create` for users without a camera.
5. **Edit [style.css](../../style.css)** — add scoped styles under a `.selfie-capture` root class. No global rules. Mobile-first: the capture button must be at least 64×64px and thumb-reachable on a 375px viewport.

## Audit checklist — must handle all of these

**Camera lifecycle**
- Request camera only after the user explicitly taps "Start camera" — never on mount. iOS Safari requires the prompt to happen inside a user gesture.
- Request `{ video: { facingMode: 'user', width: { ideal: 1024 }, height: { ideal: 1024 } }, audio: false }`.
- Store the `MediaStream` on `this._stream` and always stop all tracks (`this._stream.getTracks().forEach(t => t.stop())`) on: `unmount()`, retake-that-reopens-camera is fine but the previous stream must stop first, successful accept, navigation away (`pagehide` listener), and tab hidden (`visibilitychange` → pause/stop).

**Capture**
- Draw `<video>` onto a 1024×1024 `<canvas>` with center-crop (match shorter edge, centered).
- `canvas.toBlob(cb, 'image/jpeg', 0.92)`.
- Reject images smaller than 128×128 with an inline message.

**Review step**
- Show the frozen JPEG via `URL.createObjectURL(blob)` and `URL.revokeObjectURL` on retake / accept.
- Two buttons: **Use this photo** and **Retake**. Both must be thumb-reachable on mobile.

**Upload fallback**
- Hidden `<input type="file" accept="image/*" capture="user">`. `capture="user"` triggers the rear/front camera picker on mobile browsers that support it.
- Same review step as camera capture.
- Enforce a 10 MB client-side cap, reject anything else with an inline message.

**Errors** (no `alert()` — render inline under the preview)
- `NotAllowedError` / `PermissionDeniedError` → "Camera permission denied. Upload a photo instead." + surface the upload button.
- `NotFoundError` / `OverconstrainedError` → "No camera detected. Upload a photo instead."
- `NotReadableError` → "Camera is busy in another app. Close it and retry."

**Accessibility**
- The capture button is a real `<button>` with `aria-label="Take photo"`.
- Live preview `<video>` has `playsinline`, `muted`, `autoplay`, and no controls.
- Review step images have `alt="Captured photo"`.

## Constraints

- No new runtime dependencies.
- No framework. Plain DOM, same style as [src/avatar-creator.js](../../src/avatar-creator.js).
- Do not call Avaturn from this file. `onCaptureReady(blob)` is the seam for prompt 02.
- Do not persist the blob anywhere — not localStorage, not IndexedDB, not a fetch call. Prompt 03 handles persistence.
- Do not redesign the existing Avaturn modal. The "Skip" link reuses it unchanged.

## Verification

1. `node --check src/selfie-capture.js` — parses.
2. `npx vite build` — passes. Pre-existing `@avaturn/sdk` warning is expected; anything new is a regression.
3. Manual desktop: navigate to `/create`, allow camera, capture, retake, accept — verify `onCaptureReady` fires with a `Blob` whose `type === 'image/jpeg'` and `size > 10_000`.
4. Manual mobile (or DevTools mobile emulation + real device for camera): visit `/create` on an iPhone-sized viewport, capture works portrait, buttons are thumb-reachable.
5. Manual deny-permission: in chrome://settings block the camera, reload `/create`, confirm inline error + upload fallback path still yields a valid blob.
6. Manual leak check: mount, unmount, mount again — no double-listener, no orphan `MediaStream` (check `chrome://media-internals` or `navigator.mediaDevices.enumerateDevices()` pre/post).

## Scope boundaries — do NOT do these

- Do not hand the blob to Avaturn. That's prompt 02.
- Do not upload to R2. That's prompt 03.
- Do not collect name / description. That's prompt 04.
- Do not add confetti, share buttons, or post-creation animation. That's prompt 05.
- Do not add face-alignment overlays, beauty filters, or background removal.
- Do not add a new dependency for image processing — `<canvas>` is enough.
- Do not touch [src/viewer.js](../../src/viewer.js) or any three.js code.

## Reporting

Report:
- Files created and their line counts.
- Files edited and which sections.
- Commands run (`node --check`, `npx vite build`) and their output.
- Manual verification URLs you tested against and on what device.
- Any listener or `MediaStream` you could not find a clean teardown for.
- Any unrelated bug you spotted (do not fix).
