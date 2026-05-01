# Fix: indexer_state Table Missing from Schema (and Production DB)

## Confirmed Issue

`api/cron/[name].js` line 440–443 queries:
```js
const [cursor] = await sql`
    SELECT last_indexed_block FROM indexer_state
    WHERE contract = ${contract.toLowerCase()} AND chain_id = ${chainId}
`;
```

Confirmed: `indexer_state` does **not exist** anywhere in `api/_lib/schema.sql` or any other `.sql` file in the repo. The table was never defined.

Every `index-delegations` cron invocation throws a NeonDbError on this query for all 6 chains (1, 8453, 84532, 11155111, 421614, 11155420), which explains the flood of `index-delegations` errors in Vercel logs.

Note: `agent_delegations` IS in `schema.sql` (line 500) and is fine.

## Fix

**Step 1** — Add to `api/_lib/schema.sql` after the `agent_delegations` block (around line 529):

```sql
-- ── indexer_state — block cursor for the index-delegations cron ──────────────
create table if not exists indexer_state (
    contract           text    not null,
    chain_id           int     not null,
    last_indexed_block bigint  not null default 0,
    updated_at         timestamptz not null default now(),
    primary key (contract, chain_id)
);
```

**Step 2** — Run this SQL against the production Neon database.

**Step 3** — Also check `api/cron/[name].js` for the INSERT/UPDATE that writes back to `indexer_state` after processing, and confirm the column names match (`last_indexed_block`). Look for the line that persists the cursor after `while (fromBlock <= latestBlock)` completes.

**Step 4** — After applying, trigger the cron manually and check Vercel logs — `index-delegations` errors should stop. Note that the separate prompt for wrong topic hashes (prompt 02) must also be fixed for the indexer to actually record delegation events correctly.
