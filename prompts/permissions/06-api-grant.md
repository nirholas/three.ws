# Task 06 — `POST /api/permissions/grant`

## Why

This is the write endpoint: a signed ERC-7710 delegation arrives from the grant UI, the server verifies its signature on-chain-style (EIP-712 recover) + checks the delegator matches the agent's owner wallet, then persists it and returns the row id. Without this endpoint the UI has nothing to post to.

## Read first

- [00-README.md](./00-README.md) — canonical endpoint shape + error codes
- [api/CLAUDE.md](../../api/CLAUDE.md) — conventions (`json`, `error`, `wrap`, `cors`, `limits`, `getSessionUser`)
- [api/\_lib/http.js](../../api/_lib/http.js), [api/\_lib/auth.js](../../api/_lib/auth.js), [api/\_lib/db.js](../../api/_lib/db.js) — actual helpers you must use
- [api/\_lib/ratelimits.js](../../api/_lib/ratelimits.js) or wherever rate-limit presets live — grep for `limits.` usage
- [api/avatars/](../../api/avatars/) — a good example of an owner-gated write endpoint to mirror

## Build this

Create `api/permissions/grant.js` exporting a default handler (Vercel function signature `(req, res)`) wired via `wrap()` with:

1. **Method gate** — POST only, else `405 method_not_allowed`.
2. **CORS** — the shared `cors()` helper.
3. **Rate limit** — a strict preset (e.g. `limits.write` or `limits.strict`) keyed on `userId`. Grant writes should be infrequent.
4. **Auth** — `getSessionUser(req)`; reject with `401 unauthorized` if absent.
5. **Input validation** — body must contain:
    - `agentId` (UUID)
    - `chainId` (positive int, must be a key in `DELEGATION_MANAGER_DEPLOYMENTS` from `src/erc7710/abi.js`)
    - `delegation` (object with `delegator`, `delegate`, `caveats`, `salt`, `signature`, `hash`)
    - `scope` (matches canonical scope shape — `token`, `maxAmount`, `period`, `targets[]`, `expiry`)
6. **Owner gate** — query `agents` for the row, assert `agent.owner_user_id === user.id`. Return `403 not_owner` on mismatch.
7. **Wallet linkage** — confirm `delegation.delegator` equals the user's linked wallet address (join to `users` or `user_wallets`, whatever exists). If not linked, return `409 wallet_not_linked`.
8. **Signature verification** — import `isDelegationValid` (task 04) and call it with `{ hash: delegation.hash, chainId }`. If invalid → return `400 signature_invalid` (or whatever code the toolkit returned). Also re-derive `hash` from `delegation` and compare; reject mismatch.
9. **Scope sanity** — `expiry > now + 60`, `expiry < now + 365 days`, `maxAmount > 0`, `targets.length >= 1`, each target a checksummed 0x address.
10. **Persist** — insert into `agent_delegations` using tagged-template `sql` from `api/_lib/db.js`. `delegation_hash` is UNIQUE → on conflict, return `409 duplicate_delegation` with the existing id.
11. **Respond** — `{ ok: true, id, delegationHash, expiresAt }`.
12. **Usage event** — emit a row into `usage_events` (same pattern the MCP endpoints use — grep `usage_events` for an example) with event type `permissions.grant`.

## Don't do this

- Don't skip EIP-712 hash re-derivation — trusting the client-supplied `hash` opens replay across chains.
- Don't store the raw signature separately from `delegation_json`. It's part of the envelope.
- Don't log `delegation.signature`; log only `delegation.hash`.
- Don't add a custom JWT path — use `getSessionUser`.
- Don't allow a delegator != owner's linked wallet even if the delegator signed correctly — policy.

## Acceptance

- [ ] `api/permissions/grant.js` exists and is wired per `api/CLAUDE.md`.
- [ ] Happy path: valid signed delegation → row inserted → 200 response with id.
- [ ] Owner mismatch → 403.
- [ ] Bad signature → 400.
- [ ] Duplicate hash → 409.
- [ ] Rate-limit returns 429 after threshold.
- [ ] `node --check api/permissions/grant.js` passes.
- [ ] `npm run build` passes.

## Reporting

- `curl` transcripts for: happy path, owner mismatch, bad signature, duplicate.
- The DB row after a successful grant (redact signature bytes to the first 10 chars).
