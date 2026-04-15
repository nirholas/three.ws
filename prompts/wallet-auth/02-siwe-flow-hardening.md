# Task: Audit and harden the SIWE verify flow

## Context

Repo: `/workspaces/3D`. Sign-In with Ethereum (EIP-4361) is the primary login mode for the CZ demo. Nonce issuing lives in [api/auth/siwe/nonce.js](../../api/auth/siwe/nonce.js) and verification in [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js). The client builds the SIWE message in [public/wallet-login.js](../../public/wallet-login.js). Schema: `siwe_nonces` table in [api/_lib/schema.sql](../../api/_lib/schema.sql) (lines ~130–140).

Today the flow does the right shape of things (parse → domain check → temporal check → nonce lookup → signature recover → burn nonce → create-or-link user → session). What this task covers is making every one of those steps airtight under adversarial conditions: replay, phishing domain, chainId mismatch, clock skew, nonce exhaustion, parallel verify calls with the same nonce.

## Goal

After this task, a reviewer can tick every box on the audit checklist below and demonstrate each failure mode with a reproducible curl/test. The SIWE flow has no known replay or phishing holes.

## Deliverable

1. Audited and patched [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) covering every item in the audit checklist.
2. Audited and patched [api/auth/siwe/nonce.js](../../api/auth/siwe/nonce.js) — TTL, rate-limit bucket, entropy, per-IP nonce ceiling.
3. Cleanup for expired nonces — either a scheduled job (if the project already has one — check `scripts/`) or a lazy on-insert GC that deletes rows where `expires_at < now() - interval '1 day'`.
4. A regression script `scripts/test-siwe-flow.mjs` that exercises every failure mode listed below and asserts the expected `error` code.

## Audit checklist

**Nonce issuance — [api/auth/siwe/nonce.js](../../api/auth/siwe/nonce.js)**

- [ ] TTL is short (≤ 5 min). Current code uses `NONCE_TTL_SEC = 5 * 60` — confirm, don't lengthen.
- [ ] Nonce has ≥ 128 bits of entropy. Current code loops to pad to 16 alphanumeric chars ≈ 95 bits — document whether that's acceptable or bump to 22 chars (≈ 128 bits).
- [ ] Rate-limited per IP via `limits.authIp(ip)`. Confirm the preset applies; do not invent a new limiter.
- [ ] No user input is accepted — nonce endpoint is GET-only, no body echoed.
- [ ] Response sets `Cache-Control: no-store` (via `json()` helper in [api/_lib/http.js](../../api/_lib/http.js) — confirm the helper does this).

**Message parsing — `parseSiweMessage` in [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js)**

- [ ] Header regex anchors both `^` and `$`. It does today — don't regress.
- [ ] Address is validated as a 40-hex string *and* re-checksummed via `getAddress()` before comparison.
- [ ] `Version` must equal `'1'`. Current parser stores it but never checks the value — **fix this**.
- [ ] `Chain ID` is required (not just present — verify it's a valid integer, not `null`). Reject if missing.
- [ ] Unknown lines are ignored silently — that's fine, but `Resources:` (multi-line) is not currently handled. Decide: either parse it or explicitly reject messages that contain `Resources:`. Document the choice.

**Domain + URI binding**

- [ ] `fields.domain === new URL(env.APP_ORIGIN).host` — confirmed.
- [ ] `fields.uri` origin equals `env.APP_ORIGIN` — confirmed. Make sure the `new URL(fields.uri)` throw is caught (it is).
- [ ] On a mismatch, return `400 invalid_domain` / `invalid_uri` — do not 500.
- [ ] `APP_ORIGIN` is read from `env` (not hardcoded). Check [api/_lib/env.js](../../api/_lib/env.js) that it's a required var and throws at startup if missing.

**Temporal checks**

- [ ] `expirationTime < now` → 400 `expired`.
- [ ] `notBefore > now` → 400 `not_yet_valid`.
- [ ] `issuedAt` skew check — if `issuedAt` is more than 10 minutes in the future → 400 `clock_skew`. Currently unchecked — **add this**.
- [ ] Hard cap: reject if `expirationTime - issuedAt > 1 hour`. An attacker asking the user to sign a year-long SIWE message is not a valid flow for this site.

**Chain ID**

- [ ] SIWE message's `Chain ID` is required and recorded to `user_wallets.chain_id`.
- [ ] If `env.ALLOWED_CHAIN_IDS` is set (comma-separated), reject chain IDs outside the allowlist. If not set, accept any integer ≥ 1.
- [ ] The stored `chain_id` on `user_wallets` does not get silently overwritten to `null` on subsequent sign-ins from a different chain — the current code uses `coalesce(${chainId}, chain_id)` which is correct. Don't regress.

**Nonce lifecycle — race safety**

- [ ] Nonce row is selected, checked for `consumed_at` and `expires_at`, then `update ... where consumed_at is null returning nonce` — the returning check catches the race where two parallel verifies use the same nonce. Current code does this. Confirm and leave.
- [ ] On any verification failure (bad signature, bad domain) the nonce is **not** consumed — user can retry with the same nonce. Current code burns only after signature verification succeeds — confirm.
- [ ] Add an explicit index `create index if not exists siwe_nonces_consumed on siwe_nonces(consumed_at) where consumed_at is null` if query planning shows seq-scan. Note: `siwe_nonces_expiry` already exists.

**Signature recovery**

- [ ] `verifyMessage` from `ethers` is called — not a hand-rolled `ecrecover`. Confirmed.
- [ ] Recovered address compared lowercase against `fields.address` lowercase. Current code uses `recovered.toLowerCase() !== claimed.toLowerCase()`. Confirm.
- [ ] `getAddress(fields.address)` is used to validate checksum — message with wrong checksum → 400. Currently does this.

**Account creation on first-sign-in**

- [ ] Placeholder email `wallet-<addr>@wallet.local` — confirm there is no real email-sending path that could try to mail this. Grep `wallet.local` across `api/`.
- [ ] Race: two parallel first-sign-ins for the same address. Current code does `select from user_wallets`; if not present, insert into `users` then `user_wallets`. Wrap in a single transaction or catch 23505 on `user_wallets` unique and re-select.
- [ ] `destroySession(req)` called before minting new session (session fixation defense). Confirmed.

**Cleanup**

- [ ] Expired nonces get deleted. Either add a vacuum job in `scripts/` or a lazy `delete from siwe_nonces where expires_at < now() - interval '1 day'` on every nonce insert (cheap — bounded by rate limit).

## Constraints

- **No new dependencies.** `ethers@6.16.0` handles signature recovery; `zod` handles body parsing; `sql` handles DB.
- **Don't change the SIWE message format.** The client in [public/wallet-login.js](../../public/wallet-login.js) already builds it — altering parser behavior on the server must not require client changes except where this task explicitly calls them out (Version check, issuedAt skew).
- **Don't migrate schema in this task.** The `users`-has-`wallet_address` column and `user_wallets` table already exist. Schema changes for one-user-many-wallets belong to task 03.
- **Don't touch the login UI.** Button state, modal, error surface — that's task 04.

## Verification

1. `node --check api/auth/siwe/verify.js api/auth/siwe/nonce.js`
2. `npx vite build` — passes.
3. `node scripts/test-siwe-flow.mjs` — run against a local dev deploy:
   - Good path → 200, session cookie issued.
   - Replay with used nonce → 400 `nonce_reused`.
   - Tampered message (changed address) → 401 `invalid_signature`.
   - Wrong domain in message → 400 `invalid_domain`.
   - Expired message (`expirationTime` in the past) → 400 `expired`.
   - Clock-skewed `issuedAt` (1 day in the future) → 400 `clock_skew`.
   - Missing `Chain ID` → 400 validation-ish error.
   - Wrong signature (signer ≠ address) → 401 `invalid_signature`.
4. `psql` — confirm `siwe_nonces` rows older than a day are cleaned up.

## Scope boundaries — do NOT do these

- Do not change how wallets link to users (task 03).
- Do not add a "connect wallet" UI component (task 04).
- Do not add logout / session refresh endpoints (task 05).
- Do not refactor to use a SIWE library. Hand-rolled parser is intentional.
- Do not add Privy-specific logic — the raw SIWE path must stay self-sufficient.

## Reporting

- Which checklist items were already passing vs. which needed patching.
- Diff summary for `verify.js` and `nonce.js`.
- Output of each case in `scripts/test-siwe-flow.mjs`.
- Entropy number chosen for the nonce and the rationale (95 bits vs 128 bits).
- Unrelated bugs noticed — don't fix.
