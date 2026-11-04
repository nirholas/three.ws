---
slug: payments-x402-audit-ledger-durability
title: x402 payment audit ledger becomes durable, unique per transaction, and dead-lettered
tier: P0
score: 80
area: payments
sources: docs/financial-controls.md
---

## Why this matters

`logPaymentEvent` is fire-and-forget: events go through a microtask into a Redis buffer and are flushed to Postgres with a 3 second timeout and a throttled error log. If Redis or the database misses, the payment record is silently lost. The audit table has no uniqueness on the transaction hash, so retries can double-write and reconciliation against the chain cannot rely on it. A payments audit ledger that can silently drop rows is a data-loss risk on the money rail.

## Current state (measured by the reviewer on 2026-11-03)

- `api/_lib/x402/audit-log.js`: `logPaymentEvent` uses `queueMicrotask`, buffer key `x402:audit:buffer`, `flushAuditBuffer`, 3 s timeout, throttled error log; no dead-letter, no retry count.
- `api/_lib/migrations/2026-05-27-x402-audit-log.sql`: no UNIQUE constraint on `tx_hash`.
- Retention prune in `api/cron/[name].js` (~4119-4133) deletes after a hardcoded `AUDIT_LOG_RETENTION_DAYS = 365` with no archive.
- `revenue_ledger_entries` exists (migration `20261023170000_revenue_ledger.sql`) and is owned by the existing order `965-revenue-ledger-reinvest.md`; do not rebuild it here.

## Step 0: re-derive the current state

```
sed -n 1,200p api/_lib/x402/audit-log.js
cat api/_lib/migrations/2026-05-27-x402-audit-log.sql
sed -n 4110,4135p "api/cron/[name].js"
grep -rn "logPaymentEvent\|flushAuditBuffer" api --include=*.js -l
npm run db:status
```

## Tasks

1. Write failing tests in `tests/x402-audit-log-durability.test.js`: (a) a flush whose DB insert throws leaves the event in a dead-letter list, not dropped; (b) replaying the same event (same tx hash and event type) inserts once; (c) a flush timeout re-queues instead of discarding; (d) the flush drains in batches in order.
2. Migration (additive): partial UNIQUE index on `(tx_hash, event_type)` where `tx_hash is not null`; add `attempts int default 0` if a dead-letter table is used; create `x402_audit_dead_letter` (payload jsonb, error text, attempts, first_failed_at, last_failed_at). Dedupe any existing duplicate rows safely before creating the index (report counts; do not delete rows that differ in content).
3. Rewrite the write path to `INSERT ... ON CONFLICT DO NOTHING`, with failed batches moved to the dead-letter (Redis list `x402:audit:dead` plus a DB table when the DB is the failing side only if reachable) and a drain step that retries them with capped attempts and backoff.
4. Add a cron drain (in the existing dispatcher `api/cron/[name].js`, registered in `vercel.json` crons) and an operator-visible metric: dead-letter depth in the existing health/ops endpoint, alerting when above zero for more than 15 minutes.
5. Make the retention window an env var (`X402_AUDIT_RETENTION_DAYS`, default 365) and make the prune archive rows to a gzip JSONL object in the existing GCS bucket helper before deleting; the prune must refuse to delete a day it failed to archive. Do not delete data that cannot be regenerated without a verified archive.
6. Update `docs/financial-controls.md` rows for audit durability and retention, add a `data/changelog.json` entry.

## Definition of done

- [ ] `npx vitest run tests/x402-audit-log-durability.test.js` passes and failed before the change.
- [ ] `psql`/`npm run db:status` evidence that the unique index exists and the migration is applied.
- [ ] Killing the DB connection in a test leaves the dead-letter non-empty and a later drain empties it with exactly one row per tx hash.
- [ ] `grep -n "X402_AUDIT_RETENTION_DAYS" api/cron/\[name\].js` shows the configurable retention, and the prune path archives before delete.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Existing duplicate tx_hash rows block the unique index | Keep the earliest row per key, copy the rest to the dead-letter table with reason `dedupe`, then create the index |
| No GCS bucket helper for archives | Reuse the storage helper already used by exports under `api/_lib/` (grep `storage`), or create the minimal archive writer with the same client |
| Redis unavailable in tests | Use the repo's existing in-memory Redis test double at the boundary |

## Gates

Deleting audit rows after archive is destroying data: the prune change must archive first and verify the object; no destructive backfill of historical rows is part of this order.
