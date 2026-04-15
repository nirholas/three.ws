# Task 02 — Avaturn selfie → GLB pipeline

## Why this exists

This is the magic-moment feature: photo in, avatar out. `@avaturn/sdk` (v0.7.0) is already a dep. Avaturn runs a cloud pipeline that accepts a selfie and returns a rigged GLB with face likeness preserved. We wire it end-to-end.

## Files you own

- Create: `src/onboarding/avaturn-pipeline.js`.
- Edit: `api/_lib/env.js` — add `AVATURN_API_KEY`, `AVATURN_PARTNER_ID` (server-side only).
- Create: `api/onboarding/avaturn-session.js` — creates a short-lived Avaturn session token for the browser (so the key never ships to the client).
- Edit: `vercel.json` — one route line.

Do not modify `src/app.js` — task 04 (onboarding-flow) wires everything together.

## Deliverable

### Backend session endpoint

`POST /api/onboarding/avaturn-session`

- Requires an authenticated session (`getSessionUser`). 401 if missing.
- Calls Avaturn's REST API (consult `@avaturn/sdk` docs / source for the exact endpoint — document what you used) with `AVATURN_API_KEY` + `AVATURN_PARTNER_ID` to mint a session token bound to this user.
- Responds `200 { sessionToken, ttl, url }` — the client uses these to initialize the SDK.
- Rate-limit: add a new preset `avaturnSession: (userId) => getLimiter('avaturn:session:user', { limit: 10, window: '1 h' }).limit(userId)` in `api/_lib/rate-limit.js`.

### Client pipeline

```js
import { AvaturnPipeline } from './onboarding/avaturn-pipeline.js';

const pipe = new AvaturnPipeline();
pipe.on('progress', (p) => {}); // { step: 'upload'|'generate'|'download', pct: 0..100 }
pipe.on('preview', (blobUrl) => {}); // optional mid-stream preview
const result = await pipe.run(photoBlob);
// result = { glbBlob, glbUrl, sessionId, previewImage }
```

Steps inside `run`:
1. Fetch `/api/onboarding/avaturn-session` → `{ sessionToken, url }`.
2. Initialize Avaturn SDK with the session token.
3. Upload the blob, poll for completion (SDK usually handles this — use the SDK's built-in async flow; emit progress).
4. Download the resulting GLB as a Blob.
5. Resolve with `{ glbBlob, ... }`.

### Error surface

Each failure throws a typed error:
- `AvaturnError('quota_exceeded')`
- `AvaturnError('face_not_found')` — SDK returns a known "no face detected" state
- `AvaturnError('timeout')` — >90s without completion
- `AvaturnError('network')`
- `AvaturnError('sdk_init')`

## Constraints

- Never ship `AVATURN_API_KEY` to the browser. The browser only ever receives a session token.
- 90-second hard timeout on the whole pipeline. Cancel the SDK flow on timeout.
- If Avaturn returns a preview image before the final GLB, emit it via `preview` so the UI feels alive.
- Do not store the photo permanently on our side. If we must upload it to Avaturn via their API, do so and don't retain it.

## Acceptance test

1. `node --check` both new JS files passes.
2. Happy path: signed-in user POSTs a selfie → receives a GLB within ~60s.
3. Photo with no detectable face → `face_not_found` error propagates cleanly.
4. Unauthenticated session request → 401.
5. Rate limit: 11th session request in an hour → 429.

## Reporting

- Actual Avaturn REST endpoint names and payloads used.
- Typical run time distribution from 5 test runs (P50, P95).
- Exact SDK version imported and any workarounds.
- How the "preview before final" path worked (or didn't).
