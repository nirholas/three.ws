---
mode: agent
description: "Presign + upload the captured selfie to R2 under user-scoped key"
---

# 02-02 · Selfie upload to R2

## Why it matters

Second step of the magic moment. The selfie blob from 02-01 must land in R2 under the user's path so that (a) the avatar-generation pipeline can read it server-side, and (b) the user can later regenerate from the same photo without retaking it.

## Prerequisites

- 02-01 in place — `selfie:ready` event fires with a JPEG blob.
- R2 env vars (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`) set.

## Read these first

- [api/avatars/presign.js](../../api/avatars/presign.js) — canonical presigned PUT flow.
- [api/avatars/index.js](../../api/avatars/index.js) — the "register after upload" pattern including `headObject()` size check.
- [api/_lib/r2.js](../../api/_lib/r2.js) — presign helpers.
- [api/CLAUDE.md](../../api/CLAUDE.md) — key format: `u/{userId}/selfies/{timestamp}.jpg`.

## Build this

1. **New endpoint** `api/selfies/presign.js`:
   - Session auth required (no anonymous selfies).
   - Body: `{ content_type: 'image/jpeg', size: number }`.
   - Validate: content_type ∈ {`image/jpeg`,`image/png`}, size ≤ 8 MB.
   - Return `{ upload_url, storage_key, headers }`. Key: `u/${userId}/selfies/${Date.now()}.jpg`.
   - Rate-limit: `limits.upload(userId)`.
2. **New endpoint** `api/selfies/index.js`:
   - `POST` after upload: body `{ storage_key }`. Verify `headObject(key)`, verify key prefix matches current user, insert row into a new `selfies` table (or reuse `avatars` with `source='selfie'` — check existing schema; if adding a table, document the migration in `schema.sql`).
   - Returns `{ selfie: { id, storage_key, created_at } }`.
   - `GET` list: last 10 selfies for the user.
   - `DELETE /api/selfies/:id`: soft-delete, also queues R2 object deletion.
3. **Client wiring** in `public/selfie/selfie.js`:
   - Listen to the `selfie:ready` event from 02-01.
   - Call `/api/selfies/presign` → `PUT` the blob → `POST /api/selfies` → show "Selfie saved." with the returned `selfie.id`.
   - Preserve the blob in memory so the next step (02-03) can start immediately without a re-download.
4. **Route** both endpoints in [vercel.json](../../vercel.json).

## Schema note

If a `selfies` table doesn't exist, adding it is **a schema change** — per CLAUDE.md, this requires explicit ask. Either:
- (Preferred) Reuse `avatars` with `source='selfie'`, `content_type='image/jpeg'` and skip the size-per-avatar quota.
- Or halt and surface the migration before writing it.

## Out of scope

- Generating the avatar (02-03).
- Face detection / quality checks (could bolt on later).
- Cropping or transformation (keep original bytes).

## Deliverables

- `api/selfies/presign.js`, `api/selfies/index.js`.
- `public/selfie/selfie.js` upload wiring.
- `vercel.json` routes.
- A note in the PR description on the schema decision.

## Acceptance

- Take a selfie on `/selfie`, click "Use this photo" → object appears in R2 at `u/{userId}/selfies/{ts}.jpg`.
- List endpoint returns it.
- Delete endpoint removes it.
- All endpoints use `wrap()`, `method()`, `error()`, `json()` helpers — no hand-rolled responses.
- `npm run build` passes.
