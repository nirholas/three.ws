# Task 06 — API: Revenue Dashboard Data

## Goal
An endpoint that gives agent owners aggregated earnings data to display in the dashboard UI (Task 12).

## Success Criteria
- Returns total earnings, per-skill breakdown, and time-series data
- Scoped to the authenticated user's agents only
- Optional filter by `agent_id` query param
- Optional filter by date range (`from` / `to` ISO-8601 params)
- Returns zero-values gracefully (no earnings yet = valid response, not 404)

## Endpoint

### `GET /api/billing/revenue`

Query params:
- `agent_id` (optional UUID) — filter to a single agent
- `from` (optional ISO date) — defaults to 30 days ago
- `to` (optional ISO date) — defaults to now
- `granularity` — `day` | `week` | `month` (default: `day`)

Response:
```json
{
  "summary": {
    "gross_total": 15000000,
    "fee_total": 375000,
    "net_total": 14625000,
    "currency_mint": "EPjF...",
    "chain": "solana",
    "payment_count": 42
  },
  "by_skill": [
    { "skill": "answer-question", "net_total": 10000000, "count": 30 },
    { "skill": "generate-image",  "net_total":  4625000, "count": 12 }
  ],
  "timeseries": [
    { "period": "2026-04-01", "net_total": 500000, "count": 3 },
    { "period": "2026-04-02", "net_total": 1000000, "count": 7 }
  ]
}
```

## SQL Queries

### Summary
```sql
SELECT
  SUM(gross_amount) AS gross_total,
  SUM(fee_amount)   AS fee_total,
  SUM(net_amount)   AS net_total,
  COUNT(*)          AS payment_count,
  currency_mint, chain
FROM agent_revenue_events re
JOIN agent_identities ai ON ai.id = re.agent_id
WHERE ai.user_id = $1
  AND re.created_at BETWEEN $2 AND $3
  AND ($4::uuid IS NULL OR re.agent_id = $4)
GROUP BY currency_mint, chain
```

### Time-series (daily example)
```sql
SELECT
  date_trunc('day', created_at) AS period,
  SUM(net_amount) AS net_total,
  COUNT(*) AS count
FROM agent_revenue_events re
JOIN agent_identities ai ON ai.id = re.agent_id
WHERE ai.user_id = $1
  AND re.created_at BETWEEN $2 AND $3
GROUP BY period
ORDER BY period
```

## File to Create
`/api/billing/revenue.js`

## Verify
```bash
curl "/api/billing/revenue?from=2026-01-01&to=2026-04-30" \
  -H "Cookie: __Host-sid=..."
# Returns { summary, by_skill, timeseries }

# Without any revenue yet:
# Returns { summary: { gross_total: 0, ... }, by_skill: [], timeseries: [] }
```
