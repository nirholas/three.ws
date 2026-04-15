# Task: Link wallet(s) to a persistent user record

## Context

Repo: `/workspaces/3D`. Today there are two parallel wallet fields:

1. `users.wallet_address` — set by [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) when a brand-new user signs in with a wallet. One row per user, one wallet per user.
2. `user_wallets` table — a proper many-to-one join (`user_id`, `address`, `chain_id`, `is_primary`). Already populated by the SIWE verify path.

See [api/_lib/schema.sql](../../api/_lib/schema.sql) lines ~10–26 (`users`) and ~143–153 (`user_wallets`).

Problems:

- No API to link an additional wallet to an existing (signed-in) user. If someone logs in with email/password then connects MetaMask from the dashboard, there is no endpoint to associate the two.
- No API to unlink a wallet. If a user loses access to a wallet they need to be able to remove it.
- `users.wallet_address` and `user_wallets.address` can drift. `users.wallet_address` is effectively dead code post-signup and should be deprecated.
- Nothing enforces the "one wallet → one user" invariant at the API layer. If user A signs in with wallet X, then later user B (signed in via email/password) tries to link wallet X, the current code would either fail cryptically or hijack A's wallet.

## Goal

A clear data model and API where:
- **One user can have many wallets.** Signed message required per link.
- **One wallet belongs to exactly one user.** Attempting to link a wallet already owned by someone else returns `409 wallet_already_linked`.
- A signed-in user can list, add, set-primary, and remove wallets.
- `users.wallet_address` is kept in sync with the primary wallet (or dropped — decide in task).

## Deliverable

1. Schema patch in [api/_lib/schema.sql](../../api/_lib/schema.sql):
   - Ensure `user_wallets.address` is unique (already is — verify).
   - Add `user_wallets.label` (nullable text, for UI).
   - Add `user_wallets.linked_via` check constraint: one of `'signup_siwe' | 'link_siwe'`.
   - Decision on `users.wallet_address`: either drop the column (write a migration) or document in a comment that it's a denormalized mirror of the primary `user_wallets` row and is updated by the API. Pick one; don't leave it ambiguous.
2. New endpoint file `api/wallets.js` (plus a route in [vercel.json](../../vercel.json)):
   - `GET /api/wallets` — list caller's wallets. Auth required.
   - `POST /api/wallets/link` — body `{ message, signature }`. Verifies SIWE signature exactly like [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) but **does not mint a new session** — it requires an existing session and adds the wallet to it. If address already belongs to another user → 409.
   - `POST /api/wallets/:address/primary` — mark as primary. Unsets `is_primary` on other rows for this user.
   - `DELETE /api/wallets/:address` — unlink. If it's the only wallet and the user has no password set → 400 `cannot_remove_sole_credential`.
3. Factor the SIWE verification logic out of [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) into `api/_lib/siwe.js` exporting `verifySiwe(message, signature, { burnNonce }) → { address, chainId, fields }`. Both the login-verify endpoint and the new link endpoint import it. Don't duplicate parser / temporal / domain logic.
4. Update [src/agent-identity.js](../../src/agent-identity.js) and [src/account.js](../../src/account.js) if they call any now-changed endpoint shapes. Likely a no-op; check.

## Audit checklist

**Schema**

- [ ] `alter table user_wallets add column if not exists label text` — idempotent.
- [ ] `alter table user_wallets add column if not exists linked_via text` — idempotent.
- [ ] `user_wallets.address` unique (already enforced via `address text not null unique`).
- [ ] Partial index for `is_primary` uniqueness per user: `create unique index if not exists user_wallets_one_primary on user_wallets(user_id) where is_primary = true`.
- [ ] Decision on `users.wallet_address` documented.

**`api/_lib/siwe.js` extraction**

- [ ] Exports `parseSiweMessage`, `verifySiwe`.
- [ ] `verifySiwe` takes `{ message, signature, expectedChainIds?: number[] }` and returns recovered address + parsed fields.
- [ ] Nonce burning is **opt-in** via a parameter — link flow burns; tests may not.
- [ ] Both [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) and `api/wallets.js` use this helper.

**`GET /api/wallets`**

- [ ] Auth: session cookie or bearer with `profile` scope.
- [ ] Response: `{ wallets: [{ address, chain_id, is_primary, label, created_at, last_used_at }] }`.
- [ ] No other user's data leaked. Obvious but verify the `where user_id = ${auth.userId}` filter.
- [ ] Rate-limited with `limits.authIp(ip)`.

**`POST /api/wallets/link`**

- [ ] Requires an existing authenticated session. If no session → 401. Does **not** create a new session.
- [ ] Re-runs the full SIWE check via `api/_lib/siwe.js` — same domain/URI/chainId/temporal/nonce rules as login.
- [ ] Before insert: `select user_id from user_wallets where address = ${addr}`. If exists and `user_id === auth.userId` → 200 (idempotent re-link, bump `last_used_at`). If exists and `user_id !== auth.userId` → **409** `wallet_already_linked`. Do not reveal the owning user's id.
- [ ] Insert: `is_primary = false` by default. First wallet for a user auto-becomes primary (check existing count).
- [ ] Fire `usage_events` with `kind = 'wallet_link'`.

**`POST /api/wallets/:address/primary`**

- [ ] Wrapped in a transaction: `update ... set is_primary = false where user_id = ${uid}; update ... set is_primary = true where user_id = ${uid} and address = ${addr}`.
- [ ] 404 if wallet not owned by caller.
- [ ] If `users.wallet_address` is kept as a mirror, update it here.

**`DELETE /api/wallets/:address`**

- [ ] 404 if wallet not owned by caller.
- [ ] If removing the only wallet and `users.password_hash` is null → 400 `cannot_remove_sole_credential`. User would lock themselves out.
- [ ] If removing the current primary, auto-promote the most-recently-used other wallet to primary.
- [ ] Hard-delete the row (no soft-delete column on `user_wallets`).

**Routing**

- [ ] [vercel.json](../../vercel.json) entries for `/api/wallets`, `/api/wallets/link`, `/api/wallets/:address`, `/api/wallets/:address/primary`.
- [ ] File layout: `api/wallets.js`, `api/wallets/link.js`, `api/wallets/[address].js`, `api/wallets/[address]/primary.js` — follow the existing `api/agents.js` + `api/agents/[id]/…` pattern.

## Constraints

- **No new runtime dependencies.** `ethers`, `zod`, `sql` are enough.
- Reuse `createSession`, `sessionCookie`, `destroySession` — do not touch the session layer.
- Do not add wallet-auth UI. Task 04 covers UI.
- Do not touch `agent_identities.wallet_address`. That links the **agent's** onchain identity, not the user's login wallet. Different concern.
- Honour [api/CLAUDE.md](../../api/CLAUDE.md): use `json`, `error`, `method`, `wrap`, `cors`, `parse`, `limits`.
- Chain-ID validation must match task 02's hardening — import the same helper.

## Verification

1. `node --check api/wallets.js api/wallets/link.js api/wallets/[address].js api/wallets/[address]/primary.js api/_lib/siwe.js api/auth/siwe/verify.js`
2. `psql "$DATABASE_URL" -f api/_lib/schema.sql` — idempotent, no errors.
3. `npx vite build` — passes.
4. Manual curl sequence:
   ```bash
   # sign in as user A
   curl -c a.txt -X POST /api/auth/login -d '…'
   # link wallet
   curl -b a.txt -X POST /api/wallets/link -d '{"message":"…","signature":"0x…"}'
   # list
   curl -b a.txt /api/wallets   # expect 1 wallet, is_primary=true
   # sign in as user B, try to link same wallet → 409
   curl -c b.txt -X POST /api/auth/login -d '…'
   curl -b b.txt -X POST /api/wallets/link -d '{"message":"…same addr…"}'   # expect 409
   ```

## Scope boundaries — do NOT do these

- Do not implement a UI to link wallets (task 04).
- Do not implement session refresh or logout-everywhere (task 05).
- Do not migrate the `agent_identities.wallet_address` → `user_wallets` relationship. Agents and users have distinct wallet concerns.
- Do not add ENS resolution.
- Do not add multi-chain (Solana, Bitcoin) support. Ethereum / EVM only.

## Reporting

- Schema diff summary.
- New endpoint list with request/response shapes.
- Decision on `users.wallet_address` (kept-as-mirror or dropped).
- Extraction summary — what moved from `verify.js` into `_lib/siwe.js`.
- Curl output from the verification sequence.
- Any race or concurrency concern you noticed.
