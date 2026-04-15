---
mode: agent
description: "Re-run the selfie→avatar pipeline reusing the stored selfie, keeping the same agent id"
---

# 03-02 · Regenerate avatar from stored selfie

## Why it matters

Sometimes the first generation is off (pose, lighting, artifacts). Users should be able to "try again" without retaking a selfie. Cheap retention win.

## Prerequisites

- 02-02 (selfies stored in R2).
- 02-03 (generation pipeline + webhook).
- 03-01 (edit page exists).

## Read these first

- [api/selfies/generate.js](../../api/selfies/generate.js) — create one in 02-03.
- [api/avatars/webhook/](../../api/avatars/) — webhook handler from 02-03.

## Build this

1. **New action on edit page** (`/agent/:id/edit`): "Regenerate from my selfie" button under the Retake tab. Disabled if the user has no stored selfie.
2. **Endpoint** `POST /api/selfies/generate` already takes `{ selfie_id }`. Reuse it. After the webhook lands the new GLB and registers a new `avatars` row, also `PUT /api/agents/:id` with `{ avatar_id: new_id }` — **only if the current agent still belongs to this user** (race guard).
3. **UX**: same polling loop as 02-03 but keep the user on the edit page with a progress pill. On success, refresh the viewer with the new `avatar.url`.
4. **Cost guard**: cap regenerations at 5 per user per 24h. Use `limits.upload(userId)` or a dedicated `limits.avatarGenerate` preset (if adding a preset, do it in `api/_lib/rate-limit.js` — that's a normal helper change, not a schema change).

## Out of scope

- New selfie capture.
- Streaming progress from the provider (polling is fine).
- Multiple selfies per user (use the latest).

## Deliverables

- Button + flow in `public/agent/edit.js`.
- Any rate-limit preset addition in `api/_lib/rate-limit.js`.
- No new endpoints.

## Acceptance

- Click "Regenerate from my selfie" → avatar is replaced within ~120s, agent id unchanged.
- Attempt #6 in 24h returns `429 rate_limited`.
- `npm run build` passes.
