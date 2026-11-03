---
slug: payments-accounting-export-and-durable-ledgers
title: Move Redis-only money ledgers to Postgres and ship an accounting export
tier: P2
score: 55
area: payments
sources: docs/financial-controls.md
---

## Why this matters

The financial controls register lists ledgers that live only in Redis (the vanity bounty store is the confirmed one), which loses history on eviction, and there is no single accounting export an operator can hand to a bookkeeper. Money state that is not in Postgres cannot be audited, backed up, or reconciled.

## Current state (measured by the reviewer on 2026-11-03)

- `api/_lib/vanity-bounty-store.js` is Redis-backed (no table).
- Withdrawals, x402 audit and revenue ledger entries are in Postgres; their durability gaps are covered by sibling orders in this batch, do not touch them here.
- No `scripts/` or `api/` route produces a CSV/JSON accounting export across withdrawals, fees and bounties.

## Step 0: re-derive the current state

```
sed -n 1,160p api/_lib/vanity-bounty-store.js
grep -rn "vanity-bounty-store" api src -l
grep -rln "export.*csv\|text/csv" api scripts | head
```

## Tasks

1. Failing tests first (`tests/vanity-bounty-store.test.js`): bounty create, claim, expire and payout survive a simulated Redis flush because Postgres is the source of truth.
2. Additive migration for `vanity_bounties` (+ events table) and a one-shot backfill script `scripts/backfill-vanity-bounties.mjs` that reads Redis and upserts idempotently (dry-run flag default on).
3. Switch the store to Postgres with Redis only as an optional read cache; keep the public API of the module unchanged.
4. Add `scripts/export-accounting.mjs` (and an admin-only `GET /api/admin/accounting-export?from=&to=&format=csv|json`) joining withdrawals, platform fee events or revenue ledger entries, and bounty payouts, with stable columns, UTC timestamps and tx links. Admin auth reuses the existing admin guard.
5. Docs in `docs/financial-controls.md`, changelog entry.

## Definition of done

- [ ] `npx vitest run tests/vanity-bounty-store.test.js` passes.
- [ ] `node scripts/export-accounting.mjs --from 2026-10-01 --to 2026-10-31 --format csv | head -3` prints a header plus rows from the real database.
- [ ] The admin route returns 401 without admin credentials and 200 with them (curl evidence).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Redis contents cannot be read locally | Backfill script is dry-run capable; run it in the Cloud Run job context per the self-unblock playbook |
| Export columns unspecified | Use one row per money movement with columns date, kind, asset, amount, chain, tx, counterparty, reference |

## Gates

The backfill must not delete Redis keys. Any destructive cleanup is a separate owner decision.
