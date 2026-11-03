---
slug: payments-platform-fee-events-ledger
title: Platform fee events table records every fee taken, reconcilable against revenue and chain
tier: P1
score: 66
area: payments
sources: docs/financial-controls.md
---

## Why this matters

The financial controls register calls for a `platform_fee_events` ledger so that every platform fee (x402 split, skill marketplace cut, launch fee) has one append-only row that finance can reconcile to on-chain transfers. The table does not exist anywhere in `api/` or `scripts/`, so fee totals today are inferred from several tables and cannot be audited as one stream.

## Current state (measured by the reviewer on 2026-11-03)

- `grep -rn platform_fee_events api scripts` returns nothing.
- `revenue_ledger_entries` exists (`20261023170000_revenue_ledger.sql`), with its follow-up covered by existing order `965-revenue-ledger-reinvest.md`. This order must not duplicate it: Step 0 must read that migration and either write fee events into it if it already models fees, or add the narrower fee table and a view joining the two.
- Fee-taking code paths live in the x402 settle path (`api/_lib/x402/`), the skills marketplace split, and the pump launch fee code under `api/pump/`.

## Step 0: re-derive the current state

```
grep -rn "platform_fee_events" api scripts docs | head
sed -n 1,120p api/_lib/migrations/20261023170000_revenue_ledger.sql
grep -rniE "platform_fee|fee_bps|platformFee|author_share|split" api/_lib --include=*.js -l | head -30
ls prompts/finish | grep -i revenue
```

If the revenue ledger already records the fee leg per payment with a source tx, mark this order shipped in the report and only add the missing reconciliation view and test.

## Tasks

1. Write failing tests first (`tests/platform-fee-events.test.js`): each fee-taking path inserts exactly one event with amount, mint/asset, chain, source tx signature, payer, beneficiary and a unique idempotency key; replays do not duplicate.
2. Additive migration creating `platform_fee_events` (append-only: revoke UPDATE/DELETE via trigger or role, unique `(source, source_ref)`), indexes on `created_at` and `tx_hash`.
3. Add one helper `recordPlatformFee()` in `api/_lib/` and call it from each fee-taking path discovered in Step 0 inside the same transaction as the money-state change (use `sql.transaction`).
4. Add a reconciliation script `scripts/reconcile-platform-fees.mjs` (read-only) that compares event sums per day to on-chain transfers to the fee wallets and prints discrepancies; wire a `npm run audit:platform-fees` script.
5. Docs: update `docs/financial-controls.md` and add a `data/changelog.json` entry.

## Definition of done

- [ ] `npx vitest run tests/platform-fee-events.test.js` passes.
- [ ] `grep -rn "recordPlatformFee" api | wc -l` is at least the number of fee paths enumerated in the report.
- [ ] `npm run audit:platform-fees` runs read-only against the database and exits 0 on a consistent day.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Fee logic duplicated across handlers | Extract the single helper and call it from each; do not change fee amounts |
| Revenue ledger overlap | Join through a view; keep one writer per fact |
