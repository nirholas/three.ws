# 08 — Avatar PATCH endpoint (editor save-back)

## Why

The editor can export a GLB but has no server path to persist it. A `PATCH /api/avatars/:id` lets the editor write edited bytes back to R2 and update the DB row, creating a new version entry.

## Parallel-safety

[api/avatars/[id].js](../../api/avatars/[id].js) already exists. You must NOT rewrite it — read it and ADD a PATCH branch (or create a sibling file at `api/avatars/[id]/patch.js` if Vercel's routing supports the sibling better; default: add the branch to the existing file with an additive diff under 80 lines).

## Files you own

- Edit (additive only): [api/avatars/[id].js](../../api/avatars/[id].js) — add PATCH handler branch, keep GET/DELETE untouched.

## Read first

- [api/avatars/[id].js](../../api/avatars/[id].js) — the current shape.
- [api/avatars/presign.js](../../api/avatars/presign.js) — the R2 upload/presign pattern (reuse, don't reimplement).
- [api/\_lib/db.js](../../api/_lib/db.js), [api/\_lib/http.js](../../api/_lib/http.js), [api/\_lib/auth.js](../../api/_lib/auth.js).

## Deliverable

### `PATCH /api/avatars/:id`

- Auth: session cookie OR bearer with `avatars:write` scope.
- Body: `{ glbUrl: string }` — a signed R2 URL the client already uploaded to via the existing presign flow. NEVER accept raw GLB bytes on this endpoint.
- Steps:
    1. Load the avatar row. 404 if missing.
    2. Ownership check: `avatar.owner_user_id === user.id`. Else 403.
    3. `headObject()` the `glbUrl` key — reject if size > 25 MB or content-type is not `model/gltf-binary` (or `application/octet-stream` for R2). If the helper doesn't exist, inline a minimal HEAD via the R2 SDK already in use.
    4. Insert a row into an `avatar_versions` table (see prompt 10; if table doesn't exist yet, try the insert inside a try/catch — on missing-table error, log a warning and continue).
    5. Update the avatar row: `current_glb_url = glbUrl`, `updated_at = now()`.
    6. Return `{ ok: true, avatar: { id, currentGlbUrl, updatedAt } }`.
- Rate limit: `20/hour per user`.

## Constraints

- Additive diff. Do not change GET or DELETE behavior.
- Use `sql` tag, `json()`, `error()`.
- No new deps.

## Acceptance

- `node --check` clean.
- `npm run build` clean.
- curl an authenticated PATCH with a valid glbUrl → 200 + updated row in DB. Wrong owner → 403. Oversize object → 413 or 400 with a clear error code.

## Report

- The exact diff (or paste the added branch).
- What you did if the `avatar_versions` table isn't there.
- What `headObject` shape you used and which SDK call.
