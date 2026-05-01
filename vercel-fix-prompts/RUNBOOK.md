# Production Fix Runbook — 2026-05-01

Consolidated runbook for the 10 fix prompts in this directory. Everything code-side has shipped; operational steps remain.

---

## ✅ Already done

### Code fixes (in repo, deployed on next push)
- **#01** `parent_avatar_id` column added to `schema.sql`
- **#02** `index-delegations` topic hashes derived from ABI; `delegationHash` decoded from correct topic index
- **#03** `getRpcUrl` in `api/permissions/[action].js` has fallbacks for all 6 deployed chains
- **#04** `erc8004-crawl` default lookback reduced to 2000 blocks; 240s budget enforced
- **#06** Indexer reads `RPC_URL_<chainId>` (matches `.env.example`)
- **#08** `indexer_state` table added to `schema.sql`
- **#10** Audit log INSERT in MCP `delete_avatar` handler

### DB migrations applied to Neon production (2026-05-01)
- All 18 migrations from `api/_lib/migrations/2026-04-29-*` and `2026-04-30-*` (9 were already applied; 8 newly applied this run)
- `2026-05-01-audit-log.sql`
- Full `api/_lib/schema.sql` re-applied (idempotent) — picked up `parent_avatar_id` column and `indexer_state` table

`schema_migrations` tracking table now lists 19 applied migrations.

---

## ⚠️ Remaining operational steps

### 1. Rotate the Neon DB password (URGENT)

The production `DATABASE_URL` was pasted in chat on 2026-05-01 and must be rotated.

```
Neon Console → project → Branch → Roles → neondb_owner → Reset password
```

Then update `DATABASE_URL` in **Vercel → Settings → Environment Variables (Production)**.

### 2. Set the 10 required `req()` env vars in Vercel

Source of truth: `api/_lib/env.js` (anything wrapped in `req()` throws 500 on first access if unset).

| Variable | How to generate / where to find |
|---|---|
| `JWT_SECRET` | `openssl rand -base64 64` |
| `DATABASE_URL` | Neon connection string (rotate first — see step 1) |
| `S3_ENDPOINT` | Cloudflare R2: `https://<account_id>.r2.cloudflarestorage.com` |
| `S3_ACCESS_KEY_ID` | R2 dashboard → API tokens |
| `S3_SECRET_ACCESS_KEY` | R2 dashboard → API tokens |
| `S3_BUCKET` | Bucket name, e.g. `3d-agent-avatars` |
| `S3_PUBLIC_DOMAIN` | Public CDN URL for the bucket, no trailing slash |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys |
| `AGENT_RELAYER_KEY` | `node -e "const {Wallet}=require('ethers'); const w=Wallet.createRandom(); console.log(w.privateKey, w.address)"` — fund the address with testnet ETH |
| `VOYAGE_API_KEY` | dash.voyageai.com → API keys |

Plus these "high but optional" vars to avoid silent feature degradation:

| Variable | Notes |
|---|---|
| `JWT_KID` | Defaults to `"k1"` if unset |
| `CRON_SECRET` | Random; crons run unauthenticated if unset |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Rate limiting fails open without these |

### 3. Set paid RPC providers (fixes #07 — 429 errors)

```
RPC_URL_1=https://eth-mainnet.g.alchemy.com/v2/<KEY>          # Most important — public 1rpc.io currently 429-ing
RPC_URL_8453=https://base-mainnet.g.alchemy.com/v2/<KEY>
RPC_URL_84532=https://base-sepolia.g.alchemy.com/v2/<KEY>
RPC_URL_421614=https://arb-sepolia.g.alchemy.com/v2/<KEY>
RPC_URL_11155420=https://opt-sepolia.g.alchemy.com/v2/<KEY>
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<KEY>
```

The codebase keeps the public RPCs as automatic fallbacks, so paid endpoints only get hit during normal traffic.

### 4. Redeploy and verify

```
Vercel → Deployments → ⋯ → Redeploy
```

Then tail logs:

```bash
vercel logs --prod | grep -E '(Missing required env var|RPC HTTP 429|NeonDbError|Task timed out)'
```

Expected: empty. If anything appears, paste the error and trace it back to a fix prompt.

---

## How to apply future migrations

This repo has two separate scripts. Use them in this order:

```bash
export DATABASE_URL='postgres://...neon.tech/...?sslmode=require'

# 1. Apply tracked migrations (idempotent, recorded in schema_migrations).
node scripts/apply-migrations.mjs            # dry-run: shows pending
node scripts/apply-migrations.mjs --apply    # executes

# 2. Re-apply schema.sql for additive ALTER TABLE / CREATE TABLE (idempotent).
node scripts/apply-schema.mjs
```

Going forward, prefer adding new tables/columns as a dated migration in `api/_lib/migrations/` rather than editing `schema.sql` directly — the migrations runner is the single source of truth for production state.
