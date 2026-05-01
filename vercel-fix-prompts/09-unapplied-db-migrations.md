# Fix: 18 Database Migrations Never Applied to Production

## Confirmed Issue

There are 18 migration files in `api/_lib/migrations/` dated 2026-04-29 and 2026-04-30 that introduce tables and columns the codebase depends on. These migrations are NOT in `api/_lib/schema.sql` — they are additive files meant to be applied separately.

The Vercel logs show 500 errors on endpoints that use tables from these migrations (e.g., `pumpfun_signals`, missing columns). The migrations are idempotent (`create table if not exists`, `alter table ... add column if not exists`) so they are safe to run against production.

## Migration files to apply (in order)

```
api/_lib/migrations/2026-04-29-agent-marketplace.sql
api/_lib/migrations/2026-04-29-agent-payments.sql
api/_lib/migrations/2026-04-29-attest-event-bridge.sql
api/_lib/migrations/2026-04-29-chat-brand-config.sql
api/_lib/migrations/2026-04-29-drop-pump-relay.sql
api/_lib/migrations/2026-04-29-onchain-unified.sql
api/_lib/migrations/2026-04-29-pump-agent-stats.sql
api/_lib/migrations/2026-04-29-pump-price-points.sql
api/_lib/migrations/2026-04-29-pump-relay-delegations.sql
api/_lib/migrations/2026-04-29-pump-trades.sql
api/_lib/migrations/2026-04-29-pumpfun-monitor-cursor.sql
api/_lib/migrations/2026-04-29-token-launches.sql
api/_lib/migrations/2026-04-30-agent-monetization.sql
api/_lib/migrations/2026-04-30-chat-admin-key.sql
api/_lib/migrations/2026-04-30-notifications.sql
api/_lib/migrations/2026-04-30-pump-fun.sql
api/_lib/migrations/2026-04-30-skills-marketplace.sql
api/_lib/migrations/2026-04-30-skills-seed.sql
```

## How to apply

Run each file against the production Neon database. Each file's header shows the apply command:

```bash
# Apply all migrations in order:
for f in api/_lib/migrations/2026-04-29-*.sql api/_lib/migrations/2026-04-30-*.sql; do
    echo "Applying $f..."
    psql "$DATABASE_URL" -f "$f"
done
```

Or apply individually:
```bash
psql "$DATABASE_URL" -f api/_lib/migrations/2026-04-29-agent-marketplace.sql
psql "$DATABASE_URL" -f api/_lib/migrations/2026-04-29-agent-payments.sql
# ... etc
```

## What each migration adds (key tables/columns)

| File | Adds |
|---|---|
| agent-marketplace | marketplace columns on `agent_identities` |
| agent-payments | `payment_configs_pending`, `agent_payment_intents` |
| attest-event-bridge | pumpkit attestation bridge state tables |
| chat-brand-config | brand config table for chat widget |
| drop-pump-relay | drops unused old relay tables |
| onchain-unified | unified on-chain deploy metadata columns |
| pump-agent-stats | per-agent pump.fun live stats table |
| pump-price-points | price point time series table |
| pump-relay-delegations | hot-wallet relayer delegation table |
| pump-trades | pump.fun trade audit table |
| pumpfun-monitor-cursor | `pumpfun_signals` and monitor cursor |
| token-launches | `token_launches_pending` table |
| agent-monetization | `agent_skill_prices`, `agent_revenue_events`, `agent_payout_wallets`, `agent_withdrawals` |
| chat-admin-key | admin key storage table |
| notifications | user notifications table |
| pump-fun | pump.fun integration tables including `pumpfun_signals` |
| skills-marketplace | skills marketplace tables |
| skills-seed | seeds 15 system skills into `marketplace_skills` |

## After applying

Redeploy is not required for DB-only changes. Endpoint errors related to missing tables should resolve immediately after migration.
