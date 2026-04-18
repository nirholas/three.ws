# Task 19 — Delegation event indexer (`api/cron/index-delegations.js`)

## Why

Users can revoke on-chain anytime (via MetaMask directly, or via another dapp). Our DB must catch up. The indexer cron polls each supported chain for `DelegationDisabled` and `DelegationRedeemed` events, reconciles against `agent_delegations`, and updates `status`, `redemption_count`, `last_redeemed_at`. Without this, the UI can show "active" for delegations that are actually revoked — a trust failure.

## Read first

- [api/cron/](../../api/cron/) — existing cron endpoint structure + auth (they're typically called by Vercel cron with a shared secret)
- [vercel.json](../../vercel.json) — existing cron schedules
- [src/erc7710/abi.js](../../src/erc7710/abi.js) — task 03; has event ABIs
- [api/\_lib/db.js](../../api/_lib/db.js) — `sql`
- [00-README.md](./00-README.md) — status enum

## Build this

1. **New cron endpoint** `api/cron/index-delegations.js`:
    - Auth: verify `Authorization: Bearer ${process.env.CRON_SECRET}` (or whatever the project's existing cron auth is — grep sibling cron files).
    - For each chainId in `DELEGATION_MANAGER_DEPLOYMENTS`:
        - Read `last_indexed_block` from a tiny `indexer_state` table keyed by `(contract, chainId)`. Init to "now - 1 day" on first run.
        - Fetch logs via RPC `eth_getLogs({ address: delegationManager, topics: [<DelegationDisabled or DelegationRedeemed topic>], fromBlock, toBlock: 'latest' })`.
        - Cap `toBlock - fromBlock` at 2000 per call; loop until caught up.
        - For each `DelegationDisabled` log: `UPDATE agent_delegations SET status='revoked', revoked_at=<block timestamp>, tx_hash_revoke=<txHash> WHERE delegation_hash=<hash> AND status='active'`.
        - For each `DelegationRedeemed` log: `UPDATE agent_delegations SET redemption_count = redemption_count + 1, last_redeemed_at=<block timestamp> WHERE delegation_hash=<hash>`.
        - Advance `last_indexed_block` to the last `toBlock`.
    - Also run a **sweep**: `UPDATE agent_delegations SET status='expired' WHERE status='active' AND expires_at < NOW()`. Cheap, idempotent, catches expirations.
    - Emit a summary row into `usage_events` (`permissions.indexer.tick`) with counts.
2. **Schema**: add `specs/schema/indexer_state.sql` (self-contained, tiny):
    ```sql
    CREATE TABLE IF NOT EXISTS indexer_state (
        id          SERIAL PRIMARY KEY,
        contract    TEXT NOT NULL,
        chain_id    INTEGER NOT NULL,
        last_indexed_block BIGINT NOT NULL DEFAULT 0,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (contract, chain_id)
    );
    ```
    Apply via `scripts/apply-indexer-schema.js` mirroring task 05's script.
3. **Cron registration** in `vercel.json` — add an entry to run `/api/cron/index-delegations` every 5 minutes. Do not collide with existing cron entries (check the file first; the subscription cron from task 15 is hourly, this is 5-minutely — different paths).
4. **Protocol-bus event**: after a successful revoke sync, emit (server-side, via a lightweight in-memory channel or a DB notification) so the runtime cache (task 13) can invalidate. Low priority — document how a future enhancement would plumb this.
5. **Resilience**:
    - RPC failure for one chain must not abort the whole run. Try/catch per chain.
    - Dedup: if the same `txHash` is indexed twice (re-org or overlap), the UPDATEs are naturally idempotent — no side effects.
    - Log a structured summary: `{ chainId, fromBlock, toBlock, revokedCount, redeemedCount, elapsedMs }` to stderr for Vercel logs.

## Don't do this

- Do not use `eth_subscribe` / WebSockets — Vercel cron is stateless.
- Do not process more than 2000 blocks per RPC call — public RPCs will 429.
- Do not delete rows. Status flips only.
- Do not call the indexer on a request path — strictly cron.
- Do not rely on block timestamps being accurate to the second; ±30s is fine.

## Acceptance

- [ ] `api/cron/index-delegations.js` deployed and reachable.
- [ ] `vercel.json` registers the 5-minute cron.
- [ ] A manually triggered on-chain revoke is reflected in the DB within one cron cycle.
- [ ] A manually triggered on-chain redeem bumps `redemption_count` + sets `last_redeemed_at`.
- [ ] Expired sweep flips expired rows.
- [ ] `node --check` + `npm run build` pass.

## Reporting

- Paste a full log line from one successful run.
- Paste the DB state before + after a real revoke.
- Any RPC errors + how you handled them.
