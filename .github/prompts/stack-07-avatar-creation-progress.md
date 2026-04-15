---
mode: agent
description: "Progress UI for the 30-90s avatar generation — live status, cancel, preview"
---

# Stack Layer 2: Avatar Creation Progress UI

## Problem

Avatar generation takes 30–90s. Users won't sit through a blank spinner. Need a live progress surface that makes the wait feel intentional and shows the result the moment it lands.

## Implementation

### Page

After `/create/` submits, redirect to `/create/status/?id=<avatarId>`.

### UI

- Large status card: photo thumbnail (from upload), avatar name placeholder, status text, progress bar.
- Progress bar stages: `Uploaded → Detecting face → Generating mesh → Rigging → Ready`.
- Fun micro-copy per stage (avoid generic "Processing...").
- Cancel button (only active until ~`Rigging` stage).
- On `ready`: swap in a live 3D preview of the avatar (use [src/viewer.js](src/viewer.js)) + "View agent" + "Edit avatar" buttons.

### Polling / SSE

- Poll `GET /api/avatars/:id/status` every 2s via `setInterval`.
- OR (preferred) use SSE: `GET /api/avatars/:id/status/stream` → server-sent events with progress deltas. Implement whichever is simpler given the Vercel runtime (polling is fine for v1).
- Stop polling on `ready` or `failed`.
- Auto-redirect to `/agent/:slug` on `ready` after a 2s "celebrate" pause, OR let user click View.

### Failure state

- Show the error.
- "Try again with a different photo" → returns to `/create/`.
- "Report issue" → opens mailto or Linear form.

### Cancel

- `POST /api/avatars/:id/cancel` marks row as cancelled. Frontend navigates back to `/create/`.
- Provider call continues server-side (we eat the cost) but the avatar row is marked cancelled.

## Validation

- Submit photo → progress page shows live stage transitions.
- On ready, live 3D preview renders within 3s.
- Cancel mid-flight → returned to `/create/`, row marked cancelled.
- Refresh the status page → resumes from current state.
- Provider failure → friendly error, retry path.
- `npm run build` passes.

## Do not do this

- Do NOT use a modal over the previous page — dedicated page is easier to refresh/share.
- Do NOT pretend the progress — each stage should reflect real server state.
