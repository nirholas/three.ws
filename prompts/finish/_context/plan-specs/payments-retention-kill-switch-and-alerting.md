---
slug: payments-retention-kill-switch-and-alerting
title: Money-rail kill switch and anomaly alerting from the financial controls register
tier: P3
score: 40
area: payments
sources: docs/financial-controls.md
---

## Why this matters

The register notes there is no single operator kill switch to pause payouts and fee-wallet movements, and no alert when daily payout volume or failure rate jumps. Today an operator would have to edit env vars on Cloud Run to stop a runaway.

## Current state (measured by the reviewer on 2026-11-03)

- Payout cron `handleProcessWithdrawals` has no pause flag check (verify).
- No daily-volume or failure-rate alert on withdrawals or x402 settles.

## Step 0: re-derive the current state

```
grep -n "PAYOUTS_PAUSED\|kill\|paused" "api/cron/[name].js" | head
grep -rn "payouts_paused\|killSwitch" api | head
ls api/admin | head -30
```

## Tasks

1. Test first (`tests/payout-kill-switch.test.js`): with the flag on, the payout cron claims nothing and returns `paused:true`; with it off, normal behavior.
2. Add a `system_flags` row (or reuse the existing flags table; grep first) with `payouts_paused`, checked at the top of `handleProcessWithdrawals`, plus an admin endpoint to toggle it with an audit log row.
3. Add an anomaly check cron: payouts in the last 24h above N times the trailing 14 day median, or failure rate above 20 percent, raises the existing operator alert channel.
4. Document in `docs/financial-controls.md`; changelog entry.

## Definition of done

- [ ] `npx vitest run tests/payout-kill-switch.test.js` passes.
- [ ] Toggling the flag via the admin endpoint is reflected in the next cron response (curl evidence on a staging or local run).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No flags table | Create a small additive `system_flags` table in a migration |
| Alert channel unknown | Reuse the one used by existing cron failure alerts (grep `alert` in `api/cron/[name].js`) |
