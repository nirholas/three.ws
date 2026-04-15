# 02-05 — Selfie consent, retake, and failure recovery

**Pillar 2 — Selfie → agent.**

## Why it matters

The selfie pipeline (02-01 → 02-04) assumes the happy path. In practice: users retake photos, change their mind about privacy mid-flow, or hit generation failures (bad lighting, face not detected, timeout). Without a graceful recovery UX, a failure loses the user forever — and this is the *magic moment* we can't afford to botch.

## What to build

A three-state wrapper around the existing capture → upload → generate flow:

1. **Consent screen** (before camera permission is requested): one-screen "We'll use your photo to make a 3D avatar. Photo is stored in your account and never shared. [Continue] [Upload instead]". Persisted in localStorage — don't ask again for the same user.
2. **Retake** after capture (before upload): "Looks good? [Use this] [Retake]" on a freeze-frame of the captured photo.
3. **Recover** after generation failure: typed error codes → friendly messages + clear next action.

## Read these first

| File | Why |
|:---|:---|
| `public/studio/selfie.html` or wherever 02-01 landed | Current capture UI you are wrapping. |
| `api/avatars/presign.js` | Upload path for the selfie. |
| Backend generation endpoint from 02-02 / 02-03 | Error shape + retry semantics. |
| [src/avatar-creator.js](../../src/avatar-creator.js) | Avaturn fallback flow. Reuse as "Upload instead" path. |

## Build this

### 1. Consent screen

New component `src/components/selfie-consent.jsx` (vhtml, matches existing component style).

Text: "Take a photo → get a 3D avatar. We store your photo in your account so you can regenerate your avatar later. Never shared, never sold. Delete anytime from /dashboard/privacy."

Buttons:
- **Continue** — hides the consent, kicks off camera permission.
- **Upload instead** — opens file picker for a pre-existing photo (jpeg/png only, 8MB max).
- **Use default avatar** — skip selfie entirely, create agent with a placeholder avatar.

Persist: `localStorage.setItem('selfie-consent-v1', '1')` on Continue/Upload. Skip screen on subsequent visits unless `?reconsent=1`.

### 2. Retake state

After capture, freeze the canvas and show buttons. Don't upload yet. On **Retake**, return to live preview.

### 3. Generation error taxonomy

Backend returns typed errors (add to 02-02 if missing). Surface each with a specific message:

| Code | User message | Action |
|:---|:---|:---|
| `no_face_detected` | "We couldn't find your face. Try better lighting and look at the camera." | [Retake] |
| `multiple_faces` | "We saw more than one face. Use a photo of just you." | [Retake] / [Upload] |
| `low_quality` | "Photo is too blurry or dark. Try again in better lighting." | [Retake] |
| `provider_timeout` | "This is taking longer than usual. Retrying…" | Auto-retry once, then [Try again] |
| `provider_quota` | "We've hit our daily limit. Try again in a few hours — or upload a GLB manually." | [Upload GLB] link to `/dashboard/avatars/new` |
| `unknown` | "Something went wrong. If this keeps happening, drop us a note." | [Retake] / [Upload] |

### 4. Auto-retry logic

On `provider_timeout`, retry once after 5s. Show a progress spinner so the user knows it's still working. Do not auto-retry twice — they'll sit there.

### 5. Delete-my-selfie link

On /dashboard/privacy (create if missing — keep it minimal), list stored selfies with a "Delete permanently" button. Deletes from R2 + the `selfies` table row (whatever 02-02 landed as). Per-file, not a nuke-all button.

## Out of scope

- Do not add face-detection client-side (that's the provider's job).
- Do not add liveness checks.
- Do not add image filters / beauty modes.
- Do not rewrite 02-01's capture UI — wrap it.

## Deliverables

**New:**
- `src/components/selfie-consent.jsx`
- `public/dashboard/privacy.html` + `public/dashboard/privacy.js`
- `api/selfies/[id].js` — DELETE handler (soft-delete row, then R2 `deleteObject`).

**Modified:**
- Existing capture UI from 02-01 — wrap with consent + retake.
- Backend generator (02-02) — emit typed error codes.

## Acceptance

- [ ] First-time user sees consent screen before camera permission prompt.
- [ ] Returning user skips consent, goes straight to camera.
- [ ] Captured photo → "Use this / Retake" works in both directions.
- [ ] Simulating each failure code shows the right message + action.
- [ ] Deleting a selfie from /privacy actually removes the R2 object (verify via aws s3 cli or R2 dashboard).
- [ ] `npm run build` passes.

## Test plan

1. Clear localStorage. Visit selfie flow → consent appears. Click Continue → camera.
2. Capture → freeze → Retake → new capture works.
3. Force each error code (add a dev-only `?mock-error=no_face_detected` param to the capture page wired into the error state) → verify messages.
4. Delete selfie from /privacy → the R2 key is gone.
5. Reload after consent — consent screen skipped.
