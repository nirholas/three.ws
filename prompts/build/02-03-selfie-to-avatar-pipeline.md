---
mode: agent
description: "Wire the uploaded selfie to the avatar-generation pipeline (Avaturn or chosen provider)"
---

# 02-03 · Selfie → avatar pipeline

## Why it matters

The magic moment itself. A JPEG on R2 must become a rigged GLB at `/api/avatars/:id` that loads in the viewer. After this prompt, the user takes a selfie and — within a minute or two — sees themselves as a 3D agent.

## Prerequisites

- 02-01 (capture) and 02-02 (upload) shipped.
- Avaturn (or chosen provider) API credentials in env.

## Read these first

- [src/avatar-creator.js](../../src/avatar-creator.js) — existing Avaturn SDK integration (client-side).
- [api/avatars/index.js](../../api/avatars/index.js) — how generated avatars get registered.
- [api/_lib/r2.js](../../api/_lib/r2.js) — `presignGet` for handing a signed URL to a third-party generator.

## Build this

1. **Decision doc (one paragraph, in PR description)**: are we calling Avaturn (or Ready Player Me, or a self-hosted pipeline) from the **client** (SDK) or the **server** (REST API)? The rest of this prompt assumes server-side because it's more portable and keeps API keys out of the client. If client-side is required, note why.
2. **New endpoint** `api/selfies/generate.js`:
   - Session auth required.
   - Body: `{ selfie_id }`.
   - Resolve selfie row, generate a short-lived `presignGet` for the R2 object.
   - Submit to provider with a webhook callback URL `/api/avatars/webhook/{provider}`.
   - Insert an `avatar_jobs` row: `{ id, user_id, selfie_id, provider, provider_job_id, status: 'queued' }`. (New table — same schema-change constraint; reuse an existing table if possible or halt and surface.)
   - Return `{ job_id, status: 'queued' }`.
3. **New endpoint** `api/avatars/webhook/:provider.js`:
   - Verify webhook signature per provider's scheme.
   - On `completed`: download the GLB from the provider URL, `PUT` it to R2 at `u/{userId}/{slug}/{timestamp}.glb`, register it in `avatars` (reusing `api/avatars/index.js` helpers), mark the job `done`, set `agent_identities.avatar_id` to the new avatar (assign to the user's default agent — the one `/api/agents/me` would return).
   - On `failed`: mark the job `failed`, store the error message.
4. **Polling endpoint** `api/selfies/generate.js` → also handles `GET ?job_id=` → returns `{ status, avatar_id? }`. Keep polling simple; no websockets.
5. **Client wiring** in `public/selfie/selfie.js`:
   - After `POST /api/selfies` succeeds, call `POST /api/selfies/generate` with the `selfie_id`.
   - Poll `/api/selfies/generate?job_id=...` every 3s, max 120s.
   - On success, redirect to `/agent/${agent_id}` (or `/dashboard/` with a toast if no agent page yet — 04-01 polishes that page).

## Out of scope

- Picking between providers — make one call; document in the decision paragraph.
- Editing the avatar post-generation (03-*).
- Multiple-angle capture (single front-facing selfie).
- Anything to do with ERC-8004 registration.

## Deliverables

- `api/selfies/generate.js`
- `api/avatars/webhook/{provider}.js`
- `public/selfie/selfie.js` (polling + redirect)
- A decision paragraph in the PR description.

## Acceptance

- End-to-end: selfie capture → upload → generate job → webhook fires → avatar registered → redirected to agent page showing the generated body.
- Failed generations surface a user-readable error and allow retry without retaking the selfie.
- Webhook signature verification passes valid, rejects forged.
- `npm run build` passes.

## Open question to flag in the PR

If the chosen provider does not support webhooks, switch to a worker-side polling loop on a cron (`vercel.json` or external scheduler). Don't invent one in this prompt — surface the gap.
