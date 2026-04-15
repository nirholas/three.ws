# Task: Pin the selfie GLB to R2 and link it to an `agent_identities` row

## Context

Repo: `/workspaces/3D`. Prompt 02 leaves us with a GLB URL hosted by Avaturn (likely short-lived) plus optional thumbnail URL, delivered via `onGlbReady(glbUrl, { thumbnailUrl, avaturnSessionId })`. Prompt 01 owns camera capture. Prompt 04 owns the name/description form. This task owns the **persistence seam**: durable R2 storage + database rows tying the blob to the signed-in user and their wallet-linked agent.

Existing, reusable plumbing:

- R2 presign + register flow: [api/avatars/presign.js](../../api/avatars/presign.js) and [api/avatars/index.js](../../api/avatars/index.js). The register endpoint already verifies object existence + size via `headObject`.
- A working client-side re-upload helper that fetches a remote GLB and pushes it through presign+PUT+register: `saveRemoteGlbToAccount` in [src/account.js](../../src/account.js) — copy its pattern, don't reinvent.
- The `agent_identities` table (see table list in [api/CLAUDE.md](../../api/CLAUDE.md)). Columns relevant here: `id, user_id, name, description, avatar_id, skills, meta, wallet_address, chain_id, deleted_at`.
- The identity class callers use: [src/agent-identity.js](../../src/agent-identity.js). Its `save()` method already handles the round-trip to `PUT /api/agents/:id`. There is no existing client-side `create` helper — you'll add one.

Wallet linking (`user_wallets.address`) is handled by layer 1 (wallet auth). Assume it's populated for signed-in users and read via `/api/auth/me` (see `getMe` in [src/account.js](../../src/account.js)).

## Goal

Given `(glbUrl, { thumbnailUrl, avaturnSessionId })` from prompt 02, produce:

1. A persistent R2 object owned by the caller, registered as a row in `avatars`.
2. A new `agent_identities` row linked to that avatar (`avatar_id`) and the caller's primary wallet (`wallet_address`, `chain_id`).
3. The avatar made the caller's **default agent** — so [src/agent-identity.js](../../src/agent-identity.js) `/api/agents/me` returns it on next page load.

If the user is not signed in, redirect them through the existing wallet sign-in (layer 1) and resume the persistence step on return — do **not** drop the GLB URL on the floor.

## Deliverable

1. **New file: `src/selfie-persist.js`** — exports:
   ```js
   /**
    * @param {string} glbUrl                 - Avaturn-hosted GLB
    * @param {{ thumbnailUrl?: string,
    *          avaturnSessionId?: string,
    *          name: string,
    *          description?: string,
    *          slug: string }} meta
    * @returns {Promise<{ avatar: AvatarRow, agent: AgentRow }>}
    */
   export async function persistSelfieAgent(glbUrl, meta) { ... }
   ```
   Internally: fetch the GLB with `{ mode: 'cors' }`, compute `sha256`, presign, PUT, register via `POST /api/avatars`, then `POST /api/agents` with `{ name, description, avatar_id, skills: ['greet','present-model','remember'] }`, then fire-and-forget `linkWallet` via the existing endpoint `POST /api/agents/:id/wallet` with `{ wallet_address, chain_id }` read from the user's primary wallet.

2. **New API file: `api/agents/create.js`** (or extend [api/agents.js](../../api/agents.js)'s existing POST handler — whichever requires fewer new routes). It must accept `{ name, description, avatar_id, skills?, meta? }`, insert a row, and return `{ agent }`. Enforce:
   - `name` is validated by the same schema prompt 04 adds (`trim, min 2, max 32`, per-wallet unique, denylist).
   - `avatar_id` must belong to the caller (`SELECT ... WHERE id = $1 AND owner_id = $user`) — refuse with 404 otherwise.
   - Caller has fewer than N agents (soft cap: 10 — read from `plan_quotas` if present, else fall back to constant). Return 402 `quota_exceeded` if over.

3. **Edit [vercel.json](../../vercel.json)** — only if you create a new file at `api/agents/create.js`. If you extend [api/agents.js](../../api/agents.js) instead, no route change is needed (it already handles POST via `handleCreate` in the same handler).

4. **Edit [public/create.html](../../public/create.html)** — on `onGlbReady`, call `persistSelfieAgent(glbUrl, { name, description, slug })` with the values from prompt 04's form. On success, pass `{ agent }` to the next seam `onFirstMeet(agent)` (prompt 05). On failure, re-expose the Try-again button; do not lose the GLB URL (cache it in module state so the user can re-submit without re-running the Avaturn pipeline).

5. **Sign-in gate:** if `getMe()` returns `null` when the user lands on the persistence step, stash `{ glbUrl, thumbnailUrl, avaturnSessionId, name, description, slug }` in `sessionStorage` under key `pending_selfie_agent`, redirect to `/login?return=/create`, and on return to `/create` detect the stashed payload and resume directly at the persistence step (no re-capture).

## Audit checklist — must handle all of these

**GLB re-host**
- Fetch from Avaturn with `{ mode: 'cors' }`. If it fails CORS, log and fall back to a server-side proxy — but do **not** add a new proxy endpoint in this task; instead fail with a specific error code `glb_cors_blocked` and report it. A proxy endpoint is worth its own task.
- Compute `sha256` over the blob (use `crypto.subtle.digest` — match the helper in [src/account.js](../../src/account.js)).
- Presign via existing [api/avatars/presign.js](../../api/avatars/presign.js) with `content_type: 'model/gltf-binary'`, `size_bytes: blob.size`.
- PUT the blob with the `content-type` header returned by presign.
- Register via existing `POST /api/avatars` with `{ storage_key, size_bytes, content_type, checksum_sha256, name, description, visibility: 'private', source: 'avaturn', source_meta: { source_url: glbUrl, avaturn_session_id } }`.

**Thumbnail (optional, don't block on failure)**
- If `meta.thumbnailUrl` is present, repeat the same presign+PUT+register loop for a PNG/JPEG, but do not create an avatar row for it — attach it via `PATCH /api/avatars/:id` `{ thumbnail_key }` on the primary row. If the `avatars` schema doesn't expose `thumbnail_key` in the register body today, **log and skip** rather than blocking agent creation.

**Agent row**
- `POST /api/agents` with `{ name, description, avatar_id, skills: ['greet','present-model','remember'] }`.
- On success, the server response shape is `{ agent }`. Pass it through.
- Then `POST /api/agents/:id/wallet` with the user's primary wallet (from layer 1 — look it up via `/api/auth/me` or a new helper). Fire-and-forget; the wallet link is nice-to-have, not blocking.

**Default-agent promotion**
- [api/agents.js](../../api/agents.js) `/me` already picks the oldest non-deleted agent as default (see `handleGetOrCreateMe`). For this task, the simplest option is: if the caller had a default placeholder agent auto-created earlier (with name `'Agent'` and no `avatar_id`), soft-delete it via `DELETE /api/agents/:id` so the new one becomes `/me`. Only delete the placeholder if it has `avatar_id IS NULL` — never delete a real avatar.

**Idempotency**
- If `persistSelfieAgent` is called twice with the same `glbUrl` in the same tab (e.g. user double-clicks Try-again), serialize via a module-level in-flight Promise — return the same Promise, don't start two uploads.
- `sessionStorage['pending_selfie_agent']` must be cleared on success and on explicit user cancel. It must not outlive a successful persistence (otherwise next load re-creates).

**Errors**
| Condition | Surfaced to UI |
|---|---|
| Avaturn GLB fetch CORS / 4xx | `glb_cors_blocked` / `glb_fetch_failed` |
| Presign 429 | `quota_exceeded` |
| Avatar register 400 (size mismatch, invalid body) | `avatar_register_failed` |
| Agent create 402 | `agent_quota_exceeded` |
| Agent create 409 (name conflict) | `name_taken` — hand back to prompt 04's form |
| Anything else | `persist_failed` |

**Security**
- Never POST `owner_id` client-side — the server reads it from the session.
- Never POST a `storage_key` under another user's prefix. Existing presign enforces `u/{userId}/…` scoping; trust it.
- Do not log GLB bytes or checksums in analytics events. Log the `avatar.id` only after creation.

## Constraints

- No new runtime dependencies.
- No new DB tables or columns. If you find the schema is missing something (e.g. `thumbnail_key`), note it in the report and skip the feature gracefully — schema migration is its own task.
- Do not touch [src/avatar-creator.js](../../src/avatar-creator.js) (the existing editor flow).
- Do not touch the agent wallet-key generation in [api/_lib/agent-wallet.js](../../api/_lib/agent-wallet.js). It's generated by `handleGetOrCreateMe` already; a fresh `POST /api/agents` row should reuse the same helper in the server handler — or you can leave new-agent rows without an agent-wallet if the existing POST handler doesn't populate one. Note the behaviour in the report.

## Verification

1. `node --check src/selfie-persist.js` and `node --check api/agents.js` (or `api/agents/create.js`) — pass.
2. `npx vite build` — passes.
3. Manual happy path: signed-in user with a linked wallet runs `/create` end-to-end — check Neon:
   - one new row in `avatars` with `source = 'avaturn'`, `owner_id = your user id`, `visibility = 'private'`.
   - one new row in `agent_identities` with `avatar_id` matching, `wallet_address` matching the user's primary wallet.
   - previous placeholder agent (if any) soft-deleted (`deleted_at IS NOT NULL`).
4. Manual signed-out path: clear cookies, run `/create`, confirm redirect to `/login?return=/create`, sign in, confirm resume → same DB state as happy path. No duplicate avatar rows.
5. Manual idempotency: on the persistence screen, double-click Try-again — exactly one `avatars` row and one `agent_identities` row created.
6. Manual quota: temporarily set the soft cap to 0 — confirm UI surfaces `agent_quota_exceeded` and does not create an avatar row either (or does create + orphan it — whichever, document behaviour).
7. Manual name conflict (pre-insert a row with the chosen `name` for the same user), confirm `name_taken` is surfaced and prompt 04's form is re-shown with the existing input preserved.

## Scope boundaries — do NOT do these

- Do not validate / canonicalise the name here. Prompt 04 owns validation; this task just passes it through and surfaces 409.
- Do not play the post-creation animation, render the welcome scene, or fire confetti. Prompt 05 does.
- Do not add a migration for `thumbnail_key` or any other new column.
- Do not register the agent on-chain (ERC-8004). That's layer 6.
- Do not add profiling / telemetry endpoints.
- Do not change visibility to `public` automatically.

## Reporting

Report:
- Files created / edited with line counts.
- Which server handler you extended (`api/agents.js` POST vs new `api/agents/create.js`).
- Whether the schema supports `thumbnail_key` — if not, note and skip.
- Whether new `agent_identities` rows inherit an agent-wallet (from `generateAgentWallet()`) or not.
- `node --check` and `npx vite build` output.
- Results of the 7 manual verifications above.
- Any CORS failure or missing endpoint you had to route around.
- Any unrelated bug you noticed (do not fix).
