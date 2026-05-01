# Vercel Fix Prompts

Generated 2026-05-01 from log export + full codebase audit.
Each file is a self-contained prompt — open it in a new chat and run it.

**Run in order.** Later prompts may depend on earlier ones (e.g. migrations before testing endpoints).

---

## Priority 1 — Run First (Blockers)

### [01 — Missing parent_avatar_id Column](01-missing-parent-avatar-id-migration.md)
`avatars` table is missing `parent_avatar_id uuid` — confirmed absent from `schema.sql`. Every `POST /api/avatars` with a parent reference and every avatar list query crashes with NeonDbError.
**Fix:** `alter table avatars add column if not exists parent_avatar_id uuid references avatars(id) on delete set null;` — add to `schema.sql` and run on production.

### [02 — Wrong Event Topic Hashes in index-delegations Cron](02-wrong-event-topic-hashes-index-delegations.md)
`api/cron/[name].js` lines 319–320 compute keccak hashes for `DelegationDisabled(address,bytes32)` and `DelegationRedeemed(address,bytes32)` — both name and signature are wrong. Actual events in ABI are `DisabledDelegation(bytes32,address,address,...)` and `RedeemedDelegation(address,address,...)`. The indexer silently processes 0 events on every run.
**Fix:** Derive topics from the ABI using `new Interface(DELEGATION_MANAGER_ABI).getEvent('DisabledDelegation').topicHash`. Fix log decoding at line 476 too.

### [08 — indexer_state Table Missing from Schema](08-indexer-state-table-missing.md)
`api/cron/[name].js` queries `indexer_state` (lines 441–443) but this table is **not in `schema.sql` or any migration file**. The `index-delegations` cron throws NeonDbError on every chain, every invocation.
**Fix:** Create the table (DDL in prompt) and run against production.

### [09 — 18 Unapplied Database Migrations](09-unapplied-db-migrations.md)
18 migration files in `api/_lib/migrations/` (dated 2026-04-29 and 2026-04-30) have never been applied to production. These add tables for pumpfun, agent payments, monetization, notifications, marketplace, and more. Most 500 errors on feature endpoints trace back to these missing tables.
**Fix:** `psql "$DATABASE_URL" -f <each file>` in date order.

### [05 — Missing/Unset Vercel Environment Variables](05-missing-env-vars-vercel-dashboard.md)
`JWT_SECRET` and likely other required env vars are not set in Vercel dashboard. Causes 500 on all auth and agent wallet endpoints.
**Fix:** Set in Vercel → Settings → Environment Variables. See prompt for full list.

---

## Priority 2 — High Impact

### [03 — Missing RPC URLs for Chains 8453 / 421614 / 11155420 in Permissions Handler](03-missing-rpc-urls-permissions-handler.md)
`getRpcUrl()` in `api/permissions/[action].js` (line 635) has no fallbacks for Base mainnet (8453), Arbitrum Sepolia (421614), or Optimism Sepolia (11155420) — but all three are in `DELEGATION_MANAGER_DEPLOYMENTS`. `handleRedeem` and `handleVerify` throw "no RPC URL configured" for these chains.
**Fix:** Add public fallback RPCs to `getRpcUrl()` for all 6 deployed chains.

### [06 — index-delegations Env Var Name Mismatch](06-index-delegations-env-var-name-mismatch.md)
Cron reads `process.env[`RPC_${chainId}`]` (line 372) but `.env.example` and the permissions handler use `RPC_URL_${chainId}`. Operator-set production RPC URLs are silently ignored by the indexer.
**Fix:** Change cron line 372 to `RPC_URL_${chainId}`. Update `.env.example` with all chains.

### [07 — RPC Rate Limiting: Switch to Paid Providers](07-rpc-rate-limiting-paid-providers.md)
Logs show 429s from `1rpc.io` (Ethereum mainnet) and public Solana RPC. Public endpoints are unsuitable for production cron jobs.
**Fix:** Set `RPC_URL_1`, `RPC_URL_8453`, `SOLANA_RPC_URL` etc. in Vercel with Alchemy/Helius keys.

### [04 — erc8004-crawl Cron Timeout](04-erc8004-crawl-timeout.md)
`ERC8004_DEFAULT_LOOKBACK = 50_000` on first run causes 25+ sequential RPC calls per chain, reliably exceeding Vercel's 300s limit.
**Fix:** Lower default lookback to `2000`. Add a time-budget guard in the while loop.

---

## Priority 3 — Low / Cleanup

### [10 — Audit Log for MCP Avatar Deletion](10-audit-log-for-avatar-deletion.md)
`api/_mcp/tools/avatars.js` line 239 has a TODO for audit logging avatar deletions. Not a blocker but creates accountability gap for destructive MCP operations.
**Fix:** Create `audit_log` table, fire-and-forget INSERT after successful delete.

---

## What was checked and confirmed NOT broken

These were flagged by log analysis but are correctly implemented in the current code:

- **@zauthx402/sdk** — in `dependencies`, included in `vercel.json` `includeFiles` ✓
- **api/agents/_sub.js** — exists at `api/agents/_id/_sub.js`, imported correctly ✓
- **UUID validation** — `_sub.js` line 137 has regex check before SQL ✓
- **SIWE duplicate email** — handler uses `ON CONFLICT (email) DO UPDATE` ✓
- **permissions topicHash null** — line 912–913 has a proper guard with a descriptive throw ✓
- **@noble/curves** — `^2.2.0` in dependencies, import uses `.js` extension ✓
- **dca_strategies / agent_subscriptions / solana_attestations_cursor** — all in `schema.sql` ✓ (but may need migrations from prompt 09 to be fully functional)
