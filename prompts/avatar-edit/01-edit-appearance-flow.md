# Task: Re-enter Avaturn with the current avatar and save the edit as a new version

## Context

Repo: `/workspaces/3D`. The user creates an avatar via [src/avatar-creator.js](../../src/avatar-creator.js) which embeds the Avaturn SDK in a modal and fires `onExport(glbUrl)`. Today that is **one-shot**: there is no way to re-enter Avaturn with the existing avatar preloaded and tweak it.

The avatar bytes are stored in R2 at `u/{userId}/{slug}/{timestamp}.glb` and registered in the `avatars` table (see [api/CLAUDE.md](../../api/CLAUDE.md)). The `agent_identities.avatar_id` column points at the current avatar row. Every agent has exactly one current avatar; the rest is history.

The Avaturn SDK supports continuing from an existing session URL — our [api/avatars/[id].js](../../api/avatars/[id].js) does not yet create or return one. The dashboard at [public/dashboard/](../../public/dashboard/) is where the "Edit appearance" button lives.

## Goal

Wire a flow where the user clicks "Edit appearance" on their avatar in the dashboard → Avaturn opens prefilled with the existing avatar → on export, a **new** `avatars` row is created, linked as a new version of the existing avatar, and `agent_identities.avatar_id` is updated to point at it. The previous row is retained as a history entry.

AgentId does not change. Wallet link does not change.

## Deliverable

1. **Backend**
   - New endpoint: `POST /api/avatars/:id/session` — creates an Avaturn edit session for the given avatar the caller owns. Returns `{ sessionUrl }`. Rate-limit via `limits.upload(userId)`.
   - New column (or reuse a JSON `meta` field on `avatars`): `parent_avatar_id uuid null references avatars(id)` so history is queryable. If adding a column requires a migration, document the SQL in the reporting section — do not silently change schema.
   - New endpoint: `GET /api/avatars/:id/versions` — returns ordered list of `{ id, created_at, storage_key, is_current }` for an avatar and its ancestors.
   - Update [api/avatars/index.js](../../api/avatars/index.js) (the POST handler) to accept an optional `parent_avatar_id` in the body and persist it; when set, the newly registered avatar is treated as a version of that parent and `agent_identities.avatar_id` is updated in the same transaction.

2. **Frontend — src/avatar-creator.js**
   - Extend `AvatarCreator.open(sessionUrl, { existingAvatarUrl } = {})` so the caller can pass a preload URL. Pass it through to `AvaturnSDK.init` as whatever option the SDK exposes for "continue from this avatar" (check the SDK's current options — if no such option exists, document what would be needed and fall back to opening fresh with a warning banner in the modal).
   - Extend `onExport` signature so callers get the same `glbUrl` they do today — no breaking change.

3. **Frontend — dashboard**
   - Add an "Edit appearance" button on each avatar card in [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js).
   - Clicking it: `POST /api/avatars/:id/session` → open `AvatarCreator` with the returned sessionUrl and the current GLB URL → on export, run the upload flow from [api/avatars/presign.js](../../api/avatars/presign.js) + `POST /api/avatars` with `parent_avatar_id` set to the row being edited.
   - Show a small "version N of M" chip on the card, clickable to reveal the version list (from `GET /api/avatars/:id/versions`). Clicking a prior version calls `PATCH /api/agents/:agentId { avatar_id }` to revert.

## Audit checklist

- The avatarId on `agent_identities` changes; the agentId does **not**.
- Wallet link (`agent_identities.wallet_address`, `user_wallets`) is untouched by the flow.
- ERC-8004 record (`agent_identities.erc8004_agent_id`) is untouched. If present, surface a small warning in the UI: "Editing appearance does not update your on-chain registration. [Re-register?]". Do not auto-re-register.
- Old avatar rows are **not** deleted. Soft-delete is fine only when the user explicitly asks to prune history; this task does not add that UI.
- The parent chain is walkable — you can traverse `parent_avatar_id` back to the original selfie.
- Previewing a prior version in the dashboard does not mutate the database until the user clicks "restore".
- Deleting a user (cascade) still works — no orphaned version chains.

## Constraints

- No new runtime dependencies. Use the existing `@avaturn/sdk`.
- If Avaturn's SDK does not expose a "preload existing avatar" option in our pinned version, **do not upgrade** — document it and ship the button flow with a placeholder (fresh session) plus a `console.info` breadcrumb.
- Use the existing R2 presign flow from [api/avatars/presign.js](../../api/avatars/presign.js) + [api/avatars/index.js](../../api/avatars/index.js). Do not add a second upload path.
- Use `sql` from [_lib/db.js](../../api/_lib/db.js) tagged templates — no ORM, no raw concat.
- Use `getSessionUser` + `authenticateBearer` from [_lib/auth.js](../../api/_lib/auth.js) — same auth surface as [api/avatars/[id].js](../../api/avatars/[id].js).
- Any version-switch write must go through `PATCH /api/agents/:agentId` or a dedicated endpoint — never update `agent_identities` from client-side JS directly.

## Verification

1. `node --check` every JS file you modified.
2. `npx vite build` — expect success (ignore the pre-existing `@avaturn/sdk` resolution warning).
3. Manual:
   - Sign in, create a selfie avatar.
   - Note `agent_identities.id` and `avatar_id` in the DB.
   - Click "Edit appearance", export from Avaturn.
   - Confirm `agent_identities.id` is unchanged.
   - Confirm `agent_identities.avatar_id` points at a new `avatars` row whose `parent_avatar_id` is the original.
   - Click "version 1" chip → restore → confirm `avatar_id` is back on the original.
   - Confirm the agent's action history (`agent_actions` rows) is untouched across the full flow.
4. Sign out, sign back in with a different user, call `GET /api/avatars/:id/session` on someone else's avatar → expect 404 (`not_found`), not 403 — mirror the pattern in [api/avatars/[id].js](../../api/avatars/[id].js).

## Scope boundaries — do NOT do these

- Do not build a diff visualizer showing before/after morph targets.
- Do not implement auto-pruning of history.
- Do not touch the ERC-8004 registration flow. Re-registration is layer 6.
- Do not change the shape of `onExport(glbUrl)` callers rely on.
- Do not build in-place morph-slider editing in the dashboard — that is [05-outfits-and-accessories.md](./05-outfits-and-accessories.md) scope.

## Reporting

- Files created / edited (include which function or section).
- SQL migration needed (if any) — copy-pasteable.
- Whether Avaturn SDK supported the preload option in the pinned version; if not, what the stub looks like.
- `npx vite build` output (abbreviated).
- Any version-chain edge case you hit (circular parents, deleted middle versions, etc.).
