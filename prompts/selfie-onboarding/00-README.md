# Band 2 — Selfie → Agent

## The end state

A new user (signed in via wallet — band 1) is shown a camera viewfinder. They tap **Take selfie**. In under 60 seconds, a rigged 3D avatar that looks like them appears in the viewer, bound to their wallet identity. Their first agent is created.

## Why this matters

Typing a name, picking a body type, dragging sliders — all friction. A selfie is the *magic moment* that makes the product obvious. Every downstream priority (edit, embed, on-chain) is post-creation; if creation is slow or unclear, nothing else matters.

## Current state

- `@avaturn/sdk` (v0.7.0) is installed but not wired. Avaturn takes a selfie and returns a rigged GLB.
- `src/avatar-creator.js` may exist but hasn't been verified in this audit — band 2 prompt 01 is to discover it and plan around what's there.
- Existing avatar flow is drag-and-drop a GLB file (`src/app.js` load path). We preserve that — selfie is an additional entry point, not a replacement.
- `api/avatars/*` endpoints handle avatar CRUD and R2 storage. A created avatar must be stored there so the rest of the stack works.

## Prompts in this band

| # | File | Depends on |
|---|---|---|
| 01 | [camera-capture.md](./01-camera-capture.md) | — |
| 02 | [avaturn-pipeline.md](./02-avaturn-pipeline.md) | 01 |
| 03 | [readyplayerme-fallback.md](./03-readyplayerme-fallback.md) | 01 |
| 04 | [onboarding-flow.md](./04-onboarding-flow.md) | 02 |
| 05 | [commit-and-name.md](./05-commit-and-name.md) | 02, 04 |

01 unblocks 02 and 03 in parallel. 04 sits on top of 02. 05 is the final mile.

## Done = merged when

- Signed-in user at `/create` sees a camera preview within 200ms of page load.
- User can take photo, retake, confirm.
- A rigged GLB (via Avaturn) appears in `<model-viewer>` and in the editor within ~60s on a warm network.
- That GLB is uploaded to R2 via the existing `/api/avatars` endpoint and a new agent row is created.
- The user is redirected to `/agent/:slug` with the avatar live.
- Fail cases (denied camera permission, bad photo, API failure) each show a specific message and a retry path.

## Off-limits for this band

- Do not try to build a custom photogrammetry pipeline. Use Avaturn (primary) and Ready Player Me (fallback).
- Do not require the user to pick a body type before the photo — if the SDK needs it, default intelligently and let them change it in the editor later.
- Do not add face landmark detection or on-device ML. Upload the photo; let the SDK do the work.
- Do not gate this behind a paywall yet.
