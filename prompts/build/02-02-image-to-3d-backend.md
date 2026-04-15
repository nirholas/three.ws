# 02-02 — Selfie → 3D avatar backend

## Why it matters

This is the backend that turns a JPEG into a GLB. It is the single most product-defining endpoint in the app — the "magic moment" depends on it working end-to-end. Given the complexity, we use a third-party image-to-avatar provider rather than rolling our own ML.

## Context

- Upload frontend: `/dashboard/selfie` (built in `02-01`). Posts a JPEG to `/api/avatars/from-selfie`.
- R2 storage helper: [api/_lib/r2.js](../../api/_lib/r2.js). Objects are served via `env.R2_PUBLIC_BASE`.
- Avatar schema: [api/_lib/schema.sql](../../api/_lib/schema.sql) — `avatars` table. `source` column allows `'upload' | 'avaturn' | 'import'`; you'll add `'selfie'`.
- Existing avatar create pattern: [api/avatars/index.js](../../api/avatars/index.js).
- Session auth: `getSessionUser` in [api/_lib/auth.js](../../api/_lib/auth.js).
- Rate limits: [api/_lib/rate-limit.js](../../api/_lib/rate-limit.js) — add a new preset `selfieGenerate`.

## Provider choice

Use **Ready Player Me's** "avatar from photo" API as the default provider (docs: readyplayer.me). It returns a GLB URL given a photo upload. If a different provider is preferred at build time, the provider interface must be abstracted behind `api/_lib/avatar-gen/` so it can be swapped.

Configuration via env:

```
AVATAR_GEN_PROVIDER=rpm          # 'rpm' | 'meshy' | ...
AVATAR_GEN_API_KEY=<secret>
AVATAR_GEN_APPLICATION_ID=<rpm app id>  # provider-specific
```

If env is missing, the endpoint returns 503 `provider_not_configured` — do not fall back to a stub.

## What to build

### Provider adapter — `api/_lib/avatar-gen/index.js`

```js
export async function generateAvatarFromImage({ imageBuffer, mimeType, userId }) {
  // Returns { glbUrl, thumbnailUrl?, providerMeta }
}
```

First implementation: `api/_lib/avatar-gen/rpm.js`. It:
1. Uploads the image to RPM.
2. Polls until the avatar is ready (max 90s total; exponential backoff starting at 2s).
3. Downloads the resulting GLB into a Buffer.
4. Returns the buffer + any thumbnail URL RPM gives back.

The returned buffer (not URL) is passed back to the endpoint so **we** control where the GLB is stored. No external URLs baked into avatar records.

### Endpoint — `api/avatars/from-selfie.js`

- `POST`, session-authed, rate-limited (`selfieGenerate`: 5 per hour per user).
- Accepts `multipart/form-data` with a single file field `photo` (JPEG or PNG, ≤ 8 MB).
- Steps:
  1. Enforce plan quota (reuse avatar-count check from `api/avatars/index.js`).
  2. Call `generateAvatarFromImage`.
  3. Upload GLB buffer to R2 under `avatars/<user_id>/<uuid>.glb`. Set `content-type: model/gltf-binary`.
  4. Insert `avatars` row: `source='selfie'`, `source_meta={ provider, provider_id }`, `visibility='private'`, `name='Me'`, slug auto-generated.
  5. If the user has an `agent_identities` row, link the new avatar as `avatar_id`.
  6. Return `{ avatar: <row> }`.
- On provider failure → 502 `generation_failed` with a generic user-facing message. Log provider response server-side only.

### Schema update

Extend the `avatars.source` check constraint to include `'selfie'`. Additive migration only — do not break existing rows.

### New rate-limit preset

In [api/_lib/rate-limit.js](../../api/_lib/rate-limit.js):

```js
selfieGenerate: (userId) => getLimiter('selfie:gen', { limit: 5, window: '1 h' }).limit(userId),
```

## Out of scope

- Multi-photo or video input.
- Face detection / rejection (trust the provider).
- Queued/async generation — this endpoint blocks until done. Max 90s.
- Live progress streaming — `02-03` covers that.
- Editing the returned model server-side.

## Acceptance

1. With env configured and `/dashboard/selfie` flow from `02-01`, capture a photo → receive an `avatar` JSON response with a usable GLB URL.
2. The GLB loads in the existing viewer at `/agent/:id` for the caller.
3. The avatar row has `source='selfie'` and a `source_meta.provider` field.
4. Without env configured → 503, not 500.
5. Sixth request within an hour → 429.
6. A non-JPEG/PNG upload → 400.
7. Oversize upload → 413.
8. No provider secret leaks to the client (inspect Network tab).
9. `node --check` passes.
