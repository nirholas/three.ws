---
mode: agent
description: "First-party camera capture page that emits a JPEG blob as selfie:ready"
---

# 02-01 · Selfie capture UI

## Why it matters

Opening act of the magic moment. Today selfie capture is delegated to Ready Player Me's iframe ([public/dashboard/dashboard.js:186](../../public/dashboard/dashboard.js#L186)), which means we rely on a third-party UX for the single most emotional step in onboarding. A first-party page gives us control of the camera experience, a consistent look across providers (02-07 adapter), and the ability to run quality checks (02-05 consent/retry) before submitting to a generator.

This prompt is **capture only** — it emits a blob. Upload is 02-02, generation is 02-03, polling UI is 02-03b. Keep scope tight.

## Prerequisites

- User is signed in (Layer 1 complete). Guest flow is 02-06, not here.

## Read these first

| File | Why |
|:---|:---|
| [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js) | Existing RPM iframe flow — to understand what we're replacing. |
| [public/dashboard/index.html](../../public/dashboard/index.html) | Chrome + CSS to match. |
| [src/features/](../../src/features/) | Pattern for feature-flagged modules. Follow it. |
| [api/_lib/auth.js](../../api/_lib/auth.js) | Session requirement for downstream upload. |

## Build this

1. **New page** `public/selfie/index.html`:
   - Full-viewport dark layout matching the dashboard chrome.
   - Title, a one-sentence primer, a big centered `<video>` element (~640×640 square framing), shutter button, retake button, "Use this photo" button.
   - Mobile-first — camera should be usable on a phone.
2. **New module** `public/selfie/selfie.js`:
   - `startCamera()` → calls `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 1024, height: 1024 }, audio: false })`, pipes to `<video>`.
   - Graceful error if permission denied: show a card with "Enable camera in your browser settings" and a text link to the upload path (there is already a file-upload path in the dashboard — link to it).
   - `capture()` → draws the `<video>` frame to a hidden `<canvas>`, exports a JPEG blob at quality `0.92`. Stop the media tracks.
   - Preview the captured JPEG, offer "Retake" (restarts camera) or "Use this photo" (dispatches a `CustomEvent('selfie:ready', { detail: { blob, width, height } })` on `document`).
3. **Route** in [vercel.json](../../vercel.json): `/selfie` → `public/selfie/index.html`.
4. **Redirect if unauthenticated**: on load, `fetch('/api/auth/me')`; if 401, `location.href = '/login?next=/selfie'`.

## Out of scope

- Uploading the blob (02-02 consumes the event).
- Generating the avatar (02-03).
- Face-detection / quality scoring (could be added as 02-05).
- Video/multi-angle capture — single frontal frame is the contract.
- Any fallback to RPM's iframe. RPM is retired as the capture step; it may remain as an adapter option in 02-07 for *generation*.

## Deliverables

- `public/selfie/index.html`
- `public/selfie/selfie.js`
- Route in [vercel.json](../../vercel.json)

## Acceptance

- [ ] `/selfie` loads in Chrome + Safari desktop + iOS Safari.
- [ ] Camera permission prompt appears on first load; granting it shows the live preview.
- [ ] Denying camera shows the "enable camera" card + link to upload.
- [ ] Clicking the shutter freezes a preview; "Retake" restarts, "Use this photo" fires `selfie:ready` with a JPEG blob ≤ 2 MB.
- [ ] Unauthenticated user redirects to `/login?next=/selfie`.
- [ ] `npm run build` passes.

## Reporting

- Browsers tested + any iOS-specific quirks (the playsinline attribute, muted autoplay, orientation).
- Final blob size at quality 0.92 for a typical capture.
- Whether the page fits on a 360px-wide phone without horizontal scroll.
