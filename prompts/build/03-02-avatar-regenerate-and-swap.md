# 03-02 — Regenerate from a new selfie, swap avatar on an existing agent

**Branch:** `feat/avatar-regenerate-swap`
**Stack layer:** 3 (Edit avatar)
**Depends on:** 03-01, 02-02
**Blocks:** nothing critical, but improves 04-* user flow

## Why it matters

After 03-01, users can rename and delete. They still can't *improve* their avatar without starting over and losing the agent identity. Two operations close this gap:

1. **Regenerate** — take a new selfie, produce a new GLB, attach it to the *same* avatar row (preserves `agent_identities.avatar_id`).
2. **Swap** — pick a different existing avatar from your library as the agent's body.

Both keep agent identity, memory, and on-chain records intact across a visual refresh.

## Read these first

| File | Why |
|:---|:---|
| [api/avatars/[id].js](../../api/avatars/[id].js) | PATCH/DELETE handler. Regenerate will add a new sub-route. |
| [api/avatars/from-selfie.js](../../api/avatars/from-selfie.js) *(from 02-02)* | Generation pipeline — reuse its internals. |
| [api/agents.js](../../api/agents.js) | Agent PATCH accepts `avatar_id`. |
| [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js) | Where 03-01 placed the edit tab. |
| [src/agent-identity.js](../../src/agent-identity.js) | Client model — nothing to change; just confirm it holds no GLB state directly. |

## Build this

### Regenerate — `POST /api/avatars/:id/regenerate`

- **Auth:** required, must own the avatar.
- **Body:** `multipart/form-data` with `photo` (same contract as `POST /api/avatars/from-selfie`).
- **Behavior:** reuse the selfie-generation pipeline, but on success, **overwrite** the existing avatar's `r2_key` / `model_url` and bump `updated_at`. Do not create a new `avatars` row. Preserve `id`, `created_at`, `name`, and every other field.
- **Cleanup:** delete the old GLB object from R2 after the new one is committed.

### Swap — agent-side

Expose in the dashboard agent view a "Change body" button. It opens a picker listing the user's other avatars. Selecting one does `PATCH /api/agents/:agent_id { avatar_id }`. No new endpoint needed if `PATCH /api/agents/:id` already accepts `avatar_id` — verify first; if not, extend it.

### UI

- On the edit tab (from 03-01), add a "Regenerate from new selfie" button that reuses the 02-01 capture flow but posts to `/api/avatars/:id/regenerate` instead.
- Busy state during regeneration; live-refresh the thumbnail + 3D preview on success.
- Swap: a modal listing the user's avatars with thumbnails; click to swap.

## Out of scope

- Do not add GLB upload from disk as a regenerate source — only selfie.
- Do not add multi-agent-per-user UI.
- Do not touch onchain identity — the wallet + chain_id stay with the agent, not the avatar.

## Acceptance

- [ ] Regenerate with a new selfie keeps `avatars.id` stable and updates `model_url`.
- [ ] Old R2 object is gone after regenerate (or GC'd async — document which).
- [ ] Viewer picks up the new GLB on reload.
- [ ] Swap changes `agent_identities.avatar_id` and the agent-home page renders the new body without losing memory or skills.
- [ ] Agent's wallet / onchain record untouched after swap.
