# Fix: Missing Database Tables (Incomplete Migrations)

## Problem

Multiple endpoints return 500 errors because expected database tables do not exist in production:

```
relation "pumpfun_signals" does not exist          → /api/agents/solana/[action]
relation "dca_strategies" does not exist            → /api/cron/run-dca
relation "agent_subscriptions" does not exist       → /api/cron/run-subscriptions
relation "solana_attestations_cursor" does not exist → /api/cron/solana-attestations-crawl
```

## What to investigate

1. Find the migration files (likely in `migrations/`, `db/migrations/`, `prisma/migrations/`, or similar) for each of these four tables.
2. Confirm whether these migrations were ever run against the production database. Check if there is a migrations tracking table (e.g. `_prisma_migrations`, `knex_migrations`, or similar).
3. If using Prisma: run `npx prisma migrate status` against the production DB to see which migrations are pending.
4. If using raw SQL migrations: identify the SQL files for each missing table and run them in order.

## Tables to create

- `pumpfun_signals`
- `dca_strategies`
- `agent_subscriptions`
- `solana_attestations_cursor`

## Expected fix

- Run all pending migrations against the production database.
- Verify each table exists after migration.
- Re-test the affected endpoints:
  - `/api/agents/solana/[action]`
  - `/api/cron/run-dca`
  - `/api/cron/run-subscriptions`
  - `/api/cron/solana-attestations-crawl`
