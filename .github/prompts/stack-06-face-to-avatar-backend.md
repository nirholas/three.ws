---
mode: agent
description: "Backend pipeline that turns an uploaded selfie into a riggable GLB avatar"
---

# Stack Layer 2: Selfie → GLB Avatar Pipeline

## Problem

We need a server endpoint that accepts a selfie and returns a GLB avatar (riggable, with facial morphs) saved to the user's account. This is the technical heart of the "magic moment."

## Implementation

### Endpoint

`POST /api/avatars/create-from-photo`

Body:
```json
{ "photoKey": "uploads/<userId>/<uuid>.jpg", "name": "optional display name" }
```

Response (202 Accepted):
```json
{ "avatarId": "...", "status": "processing", "statusUrl": "/api/avatars/<id>/status" }
```

### Provider selection

Pick ONE provider to start (don't implement all):

| Provider | Pros | Cons |
|---|---|---|
| Ready Player Me | Mature, has avatar-from-photo API, GLB output with standard rig + ARKit blendshapes | Requires partner key; avatars are stylized, not photoreal |
| Meshy / Tripo AI | Photoreal head meshes | No standard rig — would need rigging pass |
| In-house (MediaPipe + blendshape fitting) | Zero vendor lock-in | Weeks of work |

**Recommend Ready Player Me** for v1 — it gives us a production-ready rigged GLB with ARKit blendshapes that our Empathy Layer can drive. Use the partner API (ask user for the API key env var — do NOT check one in).

### Pipeline steps

1. Validate photo from R2 (size, content-type, contains a face — use a simple face-detection heuristic or provider validation).
2. POST to RPM avatar-from-photo endpoint (async job).
3. Poll provider status; on completion, download the GLB.
4. Store GLB to R2 at `avatars/<userId>/<avatarId>.glb`.
5. Insert row in `avatars` table: `{ id, user_id, name, glb_url, source: 'selfie', photo_key, status: 'ready', created_at }`.
6. Optionally run Draco compression via `gltf-transform` CLI or library before storing.

### Status endpoint

`GET /api/avatars/:id/status` returns `{ status: 'processing' | 'ready' | 'failed', progress?: 0-100, error?: string }`.

### Webhook support

If provider supports webhooks, set one at `/api/webhooks/rpm` with HMAC verification. Otherwise poll every 5s from a Vercel cron for up to 2 minutes; then fail.

### Environment variables

`RPM_API_KEY`, `RPM_SUBDOMAIN` (or equivalent for chosen provider). Add to [.env.example](.env.example).

## Validation

- Upload a front-facing selfie → 30s later, a rigged GLB exists at `avatars/<userId>/<id>.glb`.
- GLB loads in the viewer with 52 ARKit morph targets visible.
- Bad photo (no face) → status `failed`, useful error.
- Provider outage → status `failed`, user can retry without re-upload.
- `npm run build` passes.

## Do not do this

- Do NOT store the raw photo forever — delete from R2 once avatar is ready (GDPR).
- Do NOT return the GLB URL until the job is fully done.
- Do NOT skip face detection — users will upload random images.
