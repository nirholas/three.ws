# Task 12 — Platform Fee Configuration & Admin Controls

## Goal
Make the platform fee configurable per-plan (or globally) and add an admin endpoint to see fee revenue. This is needed so the business can adjust fee rates without a code deploy.

## Success Criteria
- Fee BPS is readable from the database (with env var as fallback)
- Admin can view total platform fee revenue
- Fee rate is visible to agent owners when they set prices ("Platform takes X%")
- Fee rate changes take effect for new payments only (old intents are unaffected)

## DB Change
Add to the existing `plan_quotas` table (or a new `platform_config` table):

Option A — Simplest: add a `platform_config` table:
```sql
CREATE TABLE platform_config (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO platform_config (key, value) VALUES ('fee_bps', '250');
```

Option B — Use env var only (`PLATFORM_FEE_BPS`). Simpler, no DB change needed.

**Recommendation:** Use Option B for now. The `fee.js` helper from Task 04 already reads `PLATFORM_FEE_BPS`. Add a public endpoint to expose the rate to the frontend.

## New Endpoint

### `GET /api/billing/fee-info`
Public (no auth required). Returns the current platform fee rate so the UI can display it.

```json
{ "fee_bps": 250, "fee_percent": "2.5" }
```

## Admin Revenue Endpoint

### `GET /api/admin/revenue`
Admin-only. Aggregate platform fee income.

```json
{
  "total_fee_collected": 375000,
  "by_currency": [
    { "currency_mint": "EPjF...", "chain": "solana", "total": 375000 }
  ],
  "by_day": [
    { "date": "2026-04-01", "fee_total": 12500 }
  ]
}
```

SQL:
```sql
SELECT currency_mint, chain, SUM(fee_amount) AS total
FROM agent_revenue_events
WHERE created_at BETWEEN $1 AND $2
GROUP BY currency_mint, chain
```

## Frontend: Show Fee Rate in Pricing UI
In `monetization-settings.jsx` (Task 08), below each price input, show:
> "Platform fee: 2.5% — You receive $X.XX per payment"

Fetch the fee rate from `GET /api/billing/fee-info` on component mount.

## Files to Touch
- `/api/_lib/fee.js` — already created in Task 04, no change needed
- Add `/api/billing/fee-info.js` — new public endpoint
- Add `/api/admin/revenue.js` — new admin endpoint
- `src/components/monetization-settings.jsx` — add fee rate display

## Verify
```bash
curl /api/billing/fee-info
# → { fee_bps: 250, fee_percent: "2.5" }

# Change fee in env: PLATFORM_FEE_BPS=500
# → { fee_bps: 500, fee_percent: "5.0" }
```
