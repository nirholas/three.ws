# 02-01 — Selfie capture UI

## Why it matters

The "magic moment" of the product is: take a photo, get a 3D avatar. This prompt builds the front-end capture step only — no 3D generation yet. We need a clean, on-brand camera-capture flow that produces a single high-quality selfie image ready to hand to the generator in `02-02`.

## Context

- Dashboard entry: [public/dashboard/index.html](../../public/dashboard/index.html).
- Existing "Create avatar" flow opens Avaturn via [src/avatar-creator.js](../../src/avatar-creator.js). Do **not** remove that path — add the selfie path as a second option.
- Style baseline: match the dark theme + `--accent` purple gradient seen on [public/login.html](../../public/login.html).

## What to build

### New page — `public/dashboard/selfie.html`

Reachable as `/dashboard/selfie`. Pure HTML + vanilla JS, no build-graph dependency (the dashboard is served from `public/`).

Flow:

1. **Consent screen** — short copy: "We'll use one photo to build your avatar. Photo is processed on our servers, stored with your account, and never shared. You can delete it anytime." Continue button.
2. **Camera preview** — `getUserMedia({ video: { facingMode: 'user', width: { ideal: 1024 }, height: { ideal: 1024 } }, audio: false })`. Show a square live preview with a subtle face-outline guide overlay (SVG).
3. **Capture** — on click, draw the video frame to a `<canvas>`, downscale to max 1024×1024, export as JPEG at quality 0.92, store as a Blob in a module-scope variable.
4. **Review** — show the captured image with "Use this photo" and "Retake" buttons.
5. **Submit** — "Use this photo" POSTs the blob to `/api/avatars/from-selfie` (the endpoint is built in `02-02`; for now, just POST and display whatever response comes back, or a placeholder error if 404).
6. On success, navigate to `/dashboard/` with a query string `?new=<avatar_id>`.

### Dashboard entry

On [public/dashboard/index.html](../../public/dashboard/index.html), add a "From selfie" button next to the existing "Create avatar" button. It links to `/dashboard/selfie`.

### Graceful failure modes

- No camera permission → show clear error + "Upload a photo instead" fallback (standard `<input type="file" accept="image/*">`).
- No camera device → same fallback.
- Browser doesn't support `getUserMedia` → same fallback.

## Out of scope

- Any 3D generation. This prompt ends at "POST a JPEG to the backend."
- Face detection / quality scoring. Just take the photo.
- Multi-angle capture. One photo only.
- Video / animation capture.
- Mobile-specific native camera integration beyond `facingMode: 'user'`.

## Acceptance

1. Visit `/dashboard/selfie` as a signed-in user.
2. Grant camera permission → see live preview.
3. Click capture → see still image + Retake / Use buttons.
4. Retake returns to live preview.
5. Use this photo → POST fires with a JPEG blob, `Content-Type: image/jpeg`.
6. If camera denied → upload fallback input appears and works.
7. No errors in console. No leaked camera tracks (`stream.getTracks().forEach(t => t.stop())` runs on unmount/retake).
8. Page passes Lighthouse accessibility ≥ 90 (labels on all interactive elements, focus visible, no color-only signals).
