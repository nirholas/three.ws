# 02-02 — Avatar generation pipeline: JPEG → GLB

**Branch:** `feat/avatar-generation-pipeline`
**Stack layer:** 2 (Selfie → agent creation)
**Depends on:** 02-01 (the selfie capture UI posts to the endpoint this prompt builds)
**Blocks:** 02-03 (avatar↔agent link expects a persisted avatar row)

## Why it matters

02-01 ends with a JPEG blob POSTed to `/api/avatars/from-selfie`. Today that endpoint does not exist. Without it, the capture UI shows a 404 and the magic moment is dead. This is the glue between a selfie and a playable 3D avatar.

## Read these first

| File | Why |
|:---|:---|
| [src/avatar-creator.js](../../src/avatar-creator.js) | Existing Avaturn wrapper. Understand `initOptions.url` (session URL with a pre-seeded selfie). |
| [api/avatars/presign.js](../../api/avatars/presign.js), [api/avatars/index.js](../../api/avatars/index.js) | R2 presign + metadata write. Reuse, don't duplicate. |
| [api/_lib/](../../api/_lib/) | Auth middleware (`requireAuth()`), Neon client, response helpers. |
| [public/dashboard/selfie.html](../../public/dashboard/selfie.html) *(from 02-01)* | The caller. Its POST body shape defines this endpoint's input. |

## Build this

### Endpoint — `POST /api/avatars/from-selfie`

- **Auth:** required (`requireAuth()`).
- **Body:** `multipart/form-data` with a single `photo` field (JPEG, ≤ 4 MB). Reject anything else with 400.
- **Pipeline:**
  1. Stream the JPEG into a temp buffer. Reject non-JPEG magic bytes (`0xFFD8`).
  2. Upload the selfie to R2 under `selfies/<user_id>/<uuid>.jpg` — private, not publicly listable.
  3. Call the Avaturn (or equivalent) generation API with the R2 signed-read URL for the selfie. Env var: `AVATAR_GENERATION_API_KEY`. Document in `.env.example`.
  4. Poll the generation job until `status=ready` or timeout (90s). On timeout, return `202` with `{ job_id }` so the client can poll `GET /api/avatars/from-selfie/:job_id`.
  5. On success, fetch the generated GLB, stream it to R2 under `avatars/<user_id>/<uuid>.glb`, and create an `avatars` row via the same internal helper used by `POST /api/avatars`.
  6. Return the created avatar row (same shape as `POST /api/avatars`).

- **Status endpoint:** `GET /api/avatars/from-selfie/:job_id` — returns `{ status: 'pending' | 'ready' | 'failed', avatar?: {...}, error?: string }`.

### Error handling

Only validate at the boundary: reject bad input, surface upstream provider failures verbatim (redact API keys). No defensive try/catch around internal calls. If the generation provider returns a user-facing error (e.g. "no face detected"), forward it as 422 with `{ error, hint }`.

### Zero-new-dep rule

Use `@aws-sdk/client-s3` (already present). For multipart parsing on Vercel serverless, use `busboy` *only if nothing already in the repo parses multipart* — grep first. If a helper exists, use it.

## Out of scope

- Do not bind the avatar to an agent — that's 02-03.
- Do not build the capture UI — that's 02-01.
- Do not implement moderation / NSFW filtering — follow-up prompt.
- Do not add a UI for the `202 + poll` path unless needed — the 02-01 UI can block on the 200 path for the MVP.

## Acceptance

- [ ] POST with a valid JPEG returns a fully-populated avatar row within 90s or a 202 + job_id.
- [ ] POST with a PNG or non-image returns 400.
- [ ] POST without auth returns 401.
- [ ] Generated GLB loads in [src/viewer.js](../../src/viewer.js) without errors.
- [ ] Job status endpoint returns `ready` with the avatar row after a successful generation.
- [ ] Upstream provider failure ("no face") surfaces as a readable 422.
- [ ] No secrets leaked in error bodies. Check by deliberately breaking the API key.
