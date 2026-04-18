# Task 20 — `GET /api/permissions/verify`

## Why

Embeds, SDK callers, and third-party hosts need a CORS-open, unauthenticated way to verify a delegation is still valid — signature recovers, not disabled on-chain, not expired — without having to spin up their own RPC client or ABI. This is the public "is this delegation usable right now?" oracle.

## Read first

- [00-README.md](./00-README.md) — canonical endpoint shape + error codes
- [src/permissions/toolkit.js](../../src/permissions/toolkit.js) — task 04; `isDelegationValid` already exists server-usable
- [src/erc7710/abi.js](../../src/erc7710/abi.js) — `DELEGATION_MANAGER_ABI`
- [api/\_lib/http.js](../../api/_lib/http.js) — `json`, `cors`

## Build this

Create `api/permissions/verify.js` (GET only):

1. Method gate / CORS (`*`) / rate limit (`limits.read` — this can be hot).
2. **Query params**: `hash` (required, 0x + 64 hex), `chainId` (required, positive int, must exist in `DELEGATION_MANAGER_DEPLOYMENTS`).
3. **Short-circuit via DB**: `SELECT status, expires_at, delegation_json FROM agent_delegations WHERE delegation_hash = $1 AND chain_id = $2`.
    - If `status='revoked'` → return `{ ok: true, valid: false, reason: 'delegation_revoked' }`.
    - If `expires_at <= NOW()` or `status='expired'` → `{ ok: true, valid: false, reason: 'delegation_expired' }`.
    - Status `active` → continue to on-chain check.
    - Row missing → continue to on-chain check **anyway** (the delegation may have been granted outside our system — the delegator is free to grant off-platform).
4. **On-chain check** via `isDelegationValid({ hash, chainId })` (task 04):
    - Uses a read-only provider pinned to `RPC_URL_<chainId>` env var.
    - Calls `DelegationManager.isDelegationDisabled(hash)`.
    - If disabled on-chain but our DB still says `active`, **self-heal**: fire-and-forget `UPDATE agent_delegations SET status='revoked', revoked_at=NOW() WHERE delegation_hash=$1 AND status='active'`. Do not block the response on this.
5. **Response**:
    - Valid: `{ ok: true, valid: true, checkedAt: <iso>, chainId, hash }`.
    - Invalid: `{ ok: true, valid: false, reason: <canonical error code>, checkedAt, chainId, hash }`.
    - Errors in the check itself: `{ ok: false, error: 'rpc_error', message }` with 502.
6. **Caching**:
    - Valid responses: `Cache-Control: public, max-age=30, s-maxage=60`.
    - Invalid responses: `Cache-Control: public, max-age=300, s-maxage=600` (revoked/expired won't un-revoke).
    - `ETag` from the response JSON hash.
7. **No enumeration**: don't let this endpoint be a way to learn which hashes exist in our DB. Response for an unknown hash that is also NOT disabled on-chain is `{ ok: true, valid: true, reason: 'unknown_to_platform', ... }` — explicitly mark that we didn't authenticate the grant ourselves. Clients can decide what to do.

## Don't do this

- Do not require auth. This endpoint's whole point is being universally callable.
- Do not do the expensive EIP-712 signature recovery on every call — the on-chain disabled check + DB expiry check is sufficient. The signature was verified at grant time; if it's in our DB, the signature recovered at grant time.
- Do not fall over if one RPC is slow; use a 5s timeout + return `rpc_error`.
- Do not write through non-canonical error codes.

## Acceptance

- [ ] Valid delegation → `valid: true`.
- [ ] Revoked (DB only) → `valid: false, reason: 'delegation_revoked'`.
- [ ] Disabled on-chain but `active` in DB → returns `valid: false, reason: 'delegation_revoked'` AND self-heals the row.
- [ ] Expired → `valid: false, reason: 'delegation_expired'`.
- [ ] Unknown hash with on-chain not-disabled → `valid: true, reason: 'unknown_to_platform'`.
- [ ] Bad query params → 400 with canonical error.
- [ ] Cache headers set correctly per case.
- [ ] `node --check` + `npm run build` pass.

## Reporting

- Four `curl` transcripts: valid, revoked, expired, unknown.
- The self-heal UPDATE log from a test case.
- p50 / p95 latency across ~20 calls.
