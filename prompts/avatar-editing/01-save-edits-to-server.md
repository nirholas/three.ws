# Task 01 — Save editor changes back to the server

## Why this exists

The editor (`src/editor/*`) already produces modified GLB bytes via `glb-export.js`, but "save" is a browser download. Users expect their changes to persist — an edit they make today should show up on the public page tomorrow, and on every embed. This task connects the existing editor to the existing avatar store.

## Files you own

- Edit: `src/editor/index.js` — the Editor orchestrator gets a new "Save to my account" button alongside the existing "download GLB".
- Create: `src/editor/save-edits.js` — the client upload helper.
- Edit: `api/avatars/[id].js` — accept `PATCH` (or `PUT` / whatever the existing verb is) with a new GLB to replace the current model. If there's no such endpoint, extend minimally.
- Create: `api/avatars/[id]/version.js` if needed — see task 04 for full version history; here we just need "replace, overwrite the current model_url".

Do not change the editor's in-memory state management or the scene explorer.

## Deliverable

### Editor button

Placement: immediately under the existing "download GLB (N)" button in the editor GUI. Label: `💾 save to my account (N)` where N is the pending-edit count. Disabled when N=0 or user is not the owner.

Click behavior:
1. Export GLB via existing `glb-export.js`.
2. Call `saveEdits({ agentId, glbBytes })` from `save-edits.js`.
3. Show inline toast: `"Saving…"` → `"Saved ✓"` or `"Save failed"` with retry.
4. On success, reset the edit counter and the editor's snapshot baseline.

### Backend accept path

`PATCH /api/avatars/:id` (owner-only, session required):
- Validates the uploaded bytes are a GLB (magic bytes check — reuse `api/_lib/model-inspect.js` `isGLB`).
- Re-uses the existing R2 upload helper.
- Overwrites the blob at the same R2 key (or writes a new key + updates `model_url`).
- Bumps a `version` column on the avatar (integer, default 1). Task 04 turns this into full history; here it's just a counter.
- Returns `200 { avatar }` with the updated record.

### Ownership enforcement

Rebuild the auth check the way `api/avatars/[id].js` already does. Do not weaken.

### Rate limit

Add `avatarSave: (userId) => getLimiter('avatar:save:user', { limit: 60, window: '1 h' }).limit(userId)` in `api/_lib/rate-limit.js`.

## Constraints

- Do not change the public `model_url`. Embeds and links must keep working after save.
- Do not accept JSON glTF here; GLB only. JSON saves create multi-file complexity we don't need yet.
- Reject files >50 MB with a specific error.
- No partial saves — the server-side write is transactional. If R2 upload succeeds but DB update fails, roll back the blob (delete the new key).

## Acceptance test

1. `node --check` on new files.
2. Owner loads their avatar, changes a material, clicks save → toast "Saved ✓" in <2s on typical network.
3. Reload the page → the change is still there. Public viewer shows it too.
4. Non-owner attempts save → 403, clear message.
5. Upload a non-GLB payload → 400.
6. Rate-limit: 61st save in an hour → 429.

## Reporting

- The HTTP verb + route shape you chose (PATCH vs PUT vs POST).
- Whether you used key overwrite or versioned keys under the hood.
- Size of the GLB written in a typical edit (compare to original).
