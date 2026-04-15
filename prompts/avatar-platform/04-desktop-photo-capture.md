# Task: Desktop three-shot webcam photo capture

## Context

Repo: `/workspaces/3D`. We're building an Avaturn-style photo-to-avatar flow. This task handles the **desktop capture surface**: a modal that requests webcam permission, guides the user through three captures (left profile, center, right profile), and hands off a `{ left, center, right }` triple of `Blob`s to a callback.

This task does not generate the avatar — that's tasks 07 (fast, MediaPipe) and 08 (HD, NextFace backend). It also does not handle mobile capture — that's task 06. It just captures.

## Goal

After this task:

1. A new `PhotoCapture` module can be opened from anywhere in the app, prompts camera permission, and walks the user through three framed captures with clear visual guidance.
2. On completion, it resolves with `{ left: Blob, center: Blob, right: Blob }`.
3. On cancel / permission denied / error, it rejects with a typed error.
4. Reduced-motion and keyboard navigation are fully supported.

## Deliverable

1. **New module** `src/capture/photo-capture.js` exporting default class `PhotoCapture`:
   - `constructor(container, options)` — `options: { jpegQuality = 0.92, targetSize = { w: 1024, h: 1024 } }`.
   - `async open() -> Promise<{ left: Blob, center: Blob, right: Blob }>` — opens modal, resolves on success, rejects on cancel.
   - `dispose()` — stops tracks, removes DOM.
2. **Modal UX**:
   - Title: "Take three photos to build your avatar"
   - Live `<video>` preview with a face-oriented overlay guide (SVG circle + rule-of-thirds hints).
   - Current step indicator (1/3, 2/3, 3/3) + labeled step: "Left profile" / "Face forward" / "Right profile".
   - Primary button: "Capture" (`space` or `enter` to trigger).
   - Retake button on each thumbnail after capture.
   - Cancel button (`escape`).
3. **Capture pipeline**:
   - `getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } })`.
   - Draw current frame to an offscreen `<canvas>`, resize to `targetSize`, encode as JPEG at `jpegQuality` via `canvas.toBlob()`.
   - Show thumbnail for each captured step.
4. **Error handling** — rejections:
   - `PhotoCaptureError('permission_denied')` if `NotAllowedError`.
   - `PhotoCaptureError('no_camera')` if `NotFoundError`.
   - `PhotoCaptureError('cancelled')` on user cancel.
   - `PhotoCaptureError('unsupported')` if `navigator.mediaDevices` is missing.
5. **Styling** — add a block to [style.css](../../style.css) using the `capture-*` class prefix. Dark theme, matches the existing agent panel aesthetic.
6. **Accessibility**:
   - Focus trap in modal.
   - `aria-live` region announces step changes.
   - Buttons have `aria-label`.
   - `prefers-reduced-motion: reduce` disables modal entry/exit animation.

## Audit checklist

- [ ] `node --check src/capture/photo-capture.js`.
- [ ] Permission denial rejects with `PhotoCaptureError('permission_denied')`, not a generic `Error`.
- [ ] Escape key cancels; resolve/reject is exclusive (cancel after two captures does not leak a third).
- [ ] Camera tracks are stopped in all exit paths (success, cancel, error, `dispose()`).
- [ ] Thumbnails render immediately after capture — no flicker.
- [ ] Retake replaces the blob cleanly (no accumulated memory — verify by re-taking 10× and watching heap).
- [ ] On a device with no camera, the "unsupported" / "no_camera" branch shows a clear message and rejects.
- [ ] Tab key cycles inside modal only.

## Constraints

- No external deps. Pure `MediaDevices` + canvas.
- No TypeScript.
- Do not send images anywhere. This task stops at producing blobs — network is tasks 05, 08.
- Do not integrate with the viewer yet. The opener and consumer belong to a later task (07 wires the fast path).
- Do not add analytics, telemetry, or third-party pixels.

## Verification

1. Dev server, from DevTools console: `const pc = new (await import('/src/capture/photo-capture.js')).default(document.body); const triple = await pc.open();` — walks through the flow, returns three blobs.
2. Deny permission at prompt → rejects with `permission_denied`.
3. Escape during capture → rejects with `cancelled`, tracks stopped (check `pc` has no live tracks).
4. Take photos, retake the center one, finalize → the center blob reflects the retake.
5. `prefers-reduced-motion: reduce` → modal appears instantly, no slide/fade.

## Scope boundaries — do NOT do these

- No avatar generation. Blobs in, blobs out.
- No mobile browser UI (different constraints, handled in task 06).
- No upload logic.
- No file-picker fallback — webcam only. (File upload is a future addition behind a different flag.)
- Do not auto-open the capture modal on page load.

## Reporting

- Observed video resolution on your dev machine (`track.getSettings()`).
- Blob sizes for the three captures at default quality.
- Any Safari/iOS-specific quirks discovered (autoplay, `playsinline`, `getUserMedia` gating).
- Whether the rule-of-thirds overlay actually helps framing in practice, or should be removed.
