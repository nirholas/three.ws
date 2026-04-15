---
mode: agent
description: "Camera + upload UI that captures a selfie and hands it to the avatar pipeline"
---

# Stack Layer 2: Selfie Capture UI

## Problem

The magic moment of the product is "photo becomes your agent." We need the capture surface: a page where a logged-in user takes a selfie (or uploads one), previews it, confirms, and submits it to the avatar creation pipeline.

## Implementation

### Page

`public/create/index.html` — a standalone native-DOM page (follow [public/dashboard/dashboard.js](public/dashboard/dashboard.js) style, no framework).

### Flow

1. **Auth gate** — if no session, redirect to `/login.html?next=/create/`.
2. **Method picker** — two buttons: "Use Camera" and "Upload Photo".
3. **Camera path** — `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 1024, height: 1024 } })`.
   - Live `<video>` preview.
   - Circle/square crop overlay for framing guidance.
   - Capture button → draw frame to `<canvas>` at native resolution → `canvas.toBlob('image/jpeg', 0.9)`.
4. **Upload path** — `<input type="file" accept="image/jpeg,image/png,image/webp">`.
   - Validate: max 10MB, min 512px shortest side.
5. **Preview + confirm** — show captured/uploaded image, "Retake" and "Use this photo" buttons.
6. **Submit** — presigned upload to R2 (see [api/avatars/presign.js](api/avatars/presign.js) for pattern), then POST to the pipeline kickoff endpoint (`/api/avatars/create-from-photo` — see prompt stack-06).

### Camera handling

- Request permission explicitly with a button click (not on page load).
- Handle denial: show "We need camera access to take a selfie. Or upload a photo instead."
- Handle no-camera environment (desktop without webcam): fall back to upload only.
- Release the stream (`track.stop()`) when leaving the page or switching to upload.

### Mobile

- Prefer `facingMode: 'user'` (front camera).
- Full-screen camera view on mobile.
- Big touch targets (min 48px).

### Accessibility

- Alt text / aria-labels on all controls.
- Keyboard-navigable.

## Validation

- Desktop Chrome + webcam: flow completes, JPEG submitted.
- Mobile Safari: front camera opens, capture works.
- Deny camera permission → upload path still works.
- Upload 15MB file → friendly error.
- No session → redirected to login.
- `npm run build` passes.

## Do not do this

- Do NOT add a React component. Native DOM only.
- Do NOT resize/compress client-side before submit — backend does that.
- Do NOT auto-start the camera on page load; wait for user gesture (iOS requires it).
