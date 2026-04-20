# Task 09 — `POST /api/permissions/redeem` (optional relayer path)

## Why

Skills running inside a host iframe (Claude artifact, LobeHub) may not have access to a signer that can pay gas. This endpoint lets the agent's server-side runtime redeem a delegation on its behalf: the server holds the **agent's** smart-account key (never the user's), pays gas, and submits `redeemDelegations(...)` within the caveats. This is opt-in per agent; agents that prefer a pure client-side flow simply never call this.

## Read first

- [00-README.md](./00-README.md) — canonical endpoint + error codes, trust model callout ("the agent's smart account key may be held server-side only if the task explicitly says so — this is that task")
- [api/CLAUDE.md](../../api/CLAUDE.md) — `authenticateBearer` for agent-scope tokens (not user sessions)
- [src/permissions/toolkit.js](../../src/permissions/toolkit.js) — `redeemDelegation`, `isDelegationValid` (task 04)
- [api/\_lib/db.js](../../api/_lib/db.js) — persistence
- `.env.example` — add the new env vars here (do not commit real values)

## Build this

1. **Env**: add these to `.env.example` and read them via `process.env`:

    - `AGENT_RELAYER_KEY` — hex private key of a relayer EOA (server-held) that submits `redeemDelegations` on behalf of agents. One key per environment; rotate via Vercel env.
    - `AGENT_RELAYER_ADDRESS` — derived; used as the `delegate` for any delegation the relayer can redeem.
    - `RPC_URL_<CHAINID>` — per-chain RPC (e.g. `RPC_URL_84532`). Reuse existing RPC env vars if already defined in the project; grep first.
    - A feature flag `PERMISSIONS_RELAYER_ENABLED=true|false`. Default false. Endpoint 503s if false.

2. **Create `api/permissions/redeem.js`** (POST only):

    - Method/CORS/rate-limit (`limits.strict` — this one costs gas).
    - Auth: `authenticateBearer(req)` against `api_keys` table (agent-scope bearer; scope must include `permissions:redeem`). No user sessions here — this is a machine endpoint.
    - Body: `{ id: uuid, calls: [{ to, value, data }] }`, max 4 calls. Validate each call: `to` checksummed, `value` stringified wei, `data` hex.
    - Load the delegation row. 404 if missing. Reject if `status !== 'active'`.
    - Reject if `expires_at <= NOW()` and flip status to `expired` in a side-effect UPDATE.
    - Scope check (server-side, before touching chain):
        - For each call, `calls[i].to` must appear in `scope.targets`.
        - If `scope.token` is an ERC-20, reject any call with non-zero `value`.
        - If `scope.token == 'native'`, sum of `value` this period must stay ≤ `scope.maxAmount`. Compute period window from `scope.period` and `last_redeemed_at` trail (query recent rows).
        - If `scope.token` is an ERC-20 contract, decode the ERC-20 `transfer`/`transferFrom` call selector from `calls[i].data` and check the amount argument; sum across calls + period history.
    - Build signer from `AGENT_RELAYER_KEY` against `new JsonRpcProvider(RPC_URL_<chainId>)`.
    - Call `redeemDelegation({ delegation: row.delegation_json, calls, signer, chainId })` from the toolkit.
    - On success: `UPDATE agent_delegations SET redemption_count = redemption_count + 1, last_redeemed_at = NOW() WHERE id = $1`.
    - Emit `usage_events` row with event `permissions.redeem`, cost = gas used.
    - Respond `{ ok: true, txHash, receipt }` (trim receipt to `{ status, blockNumber, gasUsed }`).

3. **Failure modes**:

    - Toolkit throws `PermissionError` with code `delegation_revoked` → 409.
    - RPC error → 502 `rpc_error`.
    - Scope exceeded (our own check) → 403 `scope_exceeded`.
    - Target not allowed → 403 `target_not_allowed`.
    - Rate-limited → 429.

4. **Idempotency**: accept optional `Idempotency-Key` header; if supplied and a recent row exists for (`id`, key) → return the cached `txHash` instead of submitting a second tx. Keep the map in memory for 10 minutes or in a `permissions_idempotency` small table if you prefer durability — pick one and stick to it.

## Don't do this

- Do not hold the user's key. Ever. Only the relayer EOA.
- Do not skip scope verification on the server just because caveats are enforced on-chain. Our server checks are cheap and prevent paying gas on a doomed tx.
- Do not allow `calls.length > 4`. Batched delegation chains are out of scope for v0.1.
- Do not log `AGENT_RELAYER_KEY` or any intermediate signer state.
- Do not put this on the public MCP route — it's a bearer-token endpoint only.

## Acceptance

- [ ] Endpoint submits a real Base Sepolia tx given a valid active delegation.
- [ ] Scope violations return 403 without touching the chain.
- [ ] Expired delegation is auto-flipped to `expired`.
- [ ] Idempotency-Key prevents double-submit.
- [ ] `node --check` + `npm run build` pass.
- [ ] `.env.example` documents all new vars.

## Reporting

- Transcript of a real Base Sepolia redemption (tx hash + explorer link).
- The `scope_exceeded` response body when you intentionally over-spend.
- Gas-used delta of a typical redemption.
