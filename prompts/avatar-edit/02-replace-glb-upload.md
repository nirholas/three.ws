# Task: Direct GLB upload to replace an avatar without going through Avaturn

## Context

Repo: `/workspaces/3D`. Today the only path to set an avatar's bytes is through the Avaturn modal ([src/avatar-creator.js](../../src/avatar-creator.js)). Advanced users — people bringing their own rigged GLB, studio artists, or power users swapping to a custom model — have no way to upload directly.

The R2 upload primitives already exist:
- [api/avatars/presign.js](../../api/avatars/presign.js) returns a signed PUT URL given `{ content_type, size_bytes, slug? }`.
- [api/avatars/index.js](../../api/avatars/index.js) registers an uploaded object after the browser PUTs raw bytes. It verifies via `headObject()` that the object exists and size matches.

The agent's stable identity lives on `agent_identities` (id = agentId). The avatar bytes live in `avatars` (linked via `agent_identities.avatar_id`). The wallet linkage lives on `user_wallets` and/or `agent_identities.wallet_address`. None of these should change when the user uploads a replacement GLB.

## Goal

Ship a "Replace GLB" button on the dashboard avatar card. Clicking it opens a file picker, accepts `.glb` (reject `.gltf`, reject anything else), uploads direct-to-R2 via presign, and re-points the existing agent at the new avatar row. The same agentId keeps the same wallet link and action history.

## Deliverable

1. **Frontend — dashboard**
   - In [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js), add a "Replace GLB" action next to "Edit appearance" (from [01-edit-appearance-flow.md](./01-edit-appearance-flow.md)).
   - Use a hidden `<input type="file" accept=".glb,model/gltf-binary">`. Validate client-side:
     - Extension is `.glb`.
     - MIME type is `model/gltf-binary` or `application/octet-stream` (browsers sometimes send the latter).
     - File size ≤ the user's plan quota from `plan_quotas.max_bytes_per_avatar` (fetch once at dashboard mount via existing `/api/auth/me` or a new small endpoint if not surfaced).
   - On select: read first 4 bytes to verify the magic number `glTF` (`0x67 0x6c 0x54 0x46`). If the magic does not match, reject with an inline error — do not upload.
   - Call presign, PUT to the signed URL, then `POST /api/avatars` with `parent_avatar_id` = current avatar id, `source: 'direct-upload'`.
   - Surface an "this bypasses Avaturn — your avatar may not animate correctly if it's not rigged to the Mixamo skeleton" warning before upload. One-click confirm.

2. **Backend**
   - Extend the `createAvatarBody` schema in [_lib/validate.js](../../api/_lib/validate.js) to accept `source: 'direct-upload'` (existing values likely include `'avaturn'`, `'selfie'`, etc. — preserve them).
   - Confirm that [api/avatars/index.js](../../api/avatars/index.js)'s registration handler still calls `headObject()` + size check. No regression.
   - Add optional server-side sanity check on the registered GLB: read the first 12 bytes via a signed GET (or defer until first render). If you add it, keep it behind a feature flag so this task stays small. If skipping, note it in the report.
   - Ensure `agent_identities.avatar_id` update happens in the same SQL transaction as the `avatars` insert. Reuse the transactional helper from task 01 if that task shipped first; otherwise add it here.

3. **Compatibility check on the new GLB**
   - In [src/animation-manager.js](../../src/animation-manager.js), the `_buildBoneNameMap` already attempts retargeting. After a replace-GLB upload, trigger a client-side check: load the new GLB into the existing viewer, count bones, compute how many match the project's expected Mixamo-ish names. If under 50%, show a non-blocking warning: "Animations may not play — skeleton mismatch." Do not block the upload.
   - Do not modify `_buildBoneNameMap`. Re-use its logic read-only for the check, or call it directly.

## Audit checklist

- agentId (`agent_identities.id`) unchanged across the replace.
- Wallet fields (`agent_identities.wallet_address`, `chain_id`) unchanged.
- `agent_identities.erc8004_agent_id` unchanged. Show the same "on-chain registration will drift" warning as task 01. No auto-re-register.
- The old avatar row is **not** deleted. `parent_avatar_id` chain stays intact so the user can revert.
- Content-type is verified server-side via `headObject()` — already done by registration endpoint; do not regress it.
- `.gltf` + accompanying `.bin` is rejected (single-file GLB only for this task).
- GLB magic number is checked client-side before upload.
- Upload is scoped to the authenticated user — presign uses `userId` in the key. Do not accept a `userId` from client input.
- Rate-limited via `limits.upload(userId)`.
- Quota (`plan_quotas.max_bytes_per_avatar`, `max_total_bytes`) is enforced. Existing presign handler should already; verify and note if it doesn't.

## Constraints

- No new runtime dependencies. No GLB parser library — magic number byte check is enough client-side.
- No changes to R2 bucket config, CORS, or presign helpers in [_lib/r2.js](../../api/_lib/r2.js).
- Do not add a "drop zone" with drag-and-drop unless it's trivially cheap — the file picker is the minimum viable target.
- No server-side GLB validation beyond magic-number / header in this task. Mesh-level validation exists separately in [src/validator.js](../../src/validator.js) and MCP `validate_model` — do not wire those in here.
- Dashboard stays native-DOM — no framework.

## Verification

1. `node --check` every modified JS file.
2. `npx vite build`.
3. Manual:
   - Sign in, have an existing avatar.
   - Click "Replace GLB", pick a valid Mixamo-rigged `.glb` (find one under `public/models/` or re-export from Blender). Confirm upload succeeds, `agent_identities.avatar_id` points at the new row, `agentId` unchanged.
   - Try uploading a `.txt` renamed to `.glb` — client-side magic-number check rejects it.
   - Try uploading an oversize file — quota rejects it.
   - Try uploading a non-Mixamo rigged GLB — confirm the "skeleton mismatch" warning surfaces.
   - Revert to the prior version via the version chip (from task 01) — confirm it works.
   - Sign in as user B, try to POST to `/api/avatars` with `parent_avatar_id` pointing at user A's avatar — expect 404 `not_found`.

## Scope boundaries — do NOT do these

- Do not build a GLB viewer preview modal before confirm-upload. The existing viewer post-upload is enough.
- Do not add `.gltf` + separate asset support. Single-file `.glb` only.
- Do not add thumbnail generation. A later task will handle that.
- Do not touch the Avaturn modal.
- Do not re-validate on-chain records.

## Reporting

- Files created / edited.
- SQL migration (if any) — copy-pasteable.
- Whether `plan_quotas.max_bytes_per_avatar` was already enforced by presign; if not, where you added the check.
- Whether the skeleton-mismatch warning triggers on your test GLBs.
- `npx vite build` output.
- Any unexpected behavior from `headObject()` against newly PUT objects (eventual consistency issues, etc.).
