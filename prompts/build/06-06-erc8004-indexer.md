# 06-06 — Onchain: ERC-8004 polling indexer

**Branch:** `feat/erc8004-indexer`
**Stack layer:** 6 (Onchain portability)
**Depends on:** 06-05 (canonical ABI + address map)
**Blocks:** 06-07 (reputation UI), 14-* (agent gallery)

## Why it matters

`/api/agents/me` and the agent home need to know if an off-chain agent has an on-chain twin (and vice versa). Hitting an RPC on every page load is expensive and slow. A simple polling indexer that mirrors `Registered` and `FeedbackSubmitted` events into Neon gives us fast reads with at-most-1-block staleness.

## Read these first

| File | Why |
|:---|:---|
| [src/erc8004/abi.js](../../src/erc8004/abi.js) | Event signatures + addresses. |
| [api/_lib/db.js](../../api/_lib/db.js) | Neon client. |
| [api/_lib/migrations/](../../api/_lib/migrations/) | Migration pattern (see 00 prompt). |
| [api/agents/[id].js](../../api/agents/[id].js) | Read endpoint that will join the new tables. |

## Build this

1. **Schema** (new migration `0NN_onchain_index.sql`):
   ```sql
   create table if not exists onchain_agents (
     chain_id        bigint not null,
     token_id        bigint not null,
     wallet          text not null,
     agent_uri       text not null,
     registered_at   timestamptz not null,
     last_seen_block bigint not null,
     primary key (chain_id, token_id)
   );
   create index if not exists onchain_agents_wallet_idx on onchain_agents(wallet);

   create table if not exists onchain_reputation (
     chain_id   bigint not null,
     token_id   bigint not null,
     score_x100 integer not null,
     count      integer not null,
     updated_at timestamptz not null,
     primary key (chain_id, token_id)
   );

   create table if not exists indexer_cursor (
     chain_id     bigint primary key,
     last_block   bigint not null,
     updated_at   timestamptz not null default now()
   );
   ```
2. **Indexer** at `scripts/indexer.mjs`:
   - Reads chain list from `REGISTRY_DEPLOYMENTS`.
   - Per chain: loads cursor, queries `Registered` + `FeedbackSubmitted` from cursor → `latest - 1`, upserts rows, advances cursor.
   - Caps each query window to 5000 blocks; loops until caught up.
   - Sleeps 30s between polling cycles.
   - Logs structured JSON.
3. **Vercel cron** entry in [vercel.json](../../vercel.json) → `api/cron/index-onchain.js` calling the indexer for one cycle. 1-minute cron.
4. **Read endpoint** `api/onchain/agent/[chainId]/[tokenId].js` — returns the joined row.
5. Wire `api/agents/[id].js` to optionally include `onchain: { chain_id, token_id, score_x100, count }` if the off-chain agent has a stored chain id + token id (column `onchain_token_id` on `agents`).

## Out of scope

- Do not write a full subgraph. Polling RPC is enough for v1.
- Do not index ValidationRegistry yet (later).
- Do not back-fill historical events deeper than 100k blocks per chain.

## Acceptance

- [ ] `node scripts/indexer.mjs --chain 11155111 --once` runs, advances cursor, populates rows.
- [ ] Cron endpoint returns `{ ok, processed: N, chain_id }`.
- [ ] `GET /api/onchain/agent/11155111/<tokenId>` returns the row.
- [ ] Agent detail endpoint includes the `onchain` field when applicable.

## Test plan

1. Anvil locally. Deploy via 06-05. Mint a couple of test agents + submit feedback.
2. Run `node scripts/indexer.mjs --chain 31337 --once`. Verify rows.
3. Run again — cursor advances, no duplicates.
4. Curl the read endpoint.
