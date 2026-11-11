---
name: account-billing
description: Check a three.ws account's plan quotas, metered usage, invoices, receipts and the platform fee rate through the billing-mcp tools. Use when asked how much of a plan is left, what was charged in a month, or for a receipt or CSV export.
---

# three.ws account billing (read-only)

The plugin starts `@three-ws/billing-mcp` over stdio (`npx -y @three-ws/billing-mcp`). Every tool only reads. Nothing here charges, refunds or changes a plan.

## Environment

- `THREE_WS_SESSION`: the value of the `__Host-sid` cookie from a signed-in three.ws browser session. It is required for every tool except `get_fee_info`. Treat it like a password. Never print it or write it into a file. Without it the account-scoped tools fail with code `no_session`.
- `THREE_WS_BASE`: API origin, default `https://three.ws`.
- `THREE_WS_TIMEOUT_MS`: per-request timeout in milliseconds.

## Tools

| Tool | Arguments | Needs session | Endpoint |
| --- | --- | --- | --- |
| `get_billing_summary` | none | yes | `/api/billing/summary` |
| `query_usage` | `period` (`YYYY-MM`), or `from` and `to` (ISO-8601, `to` exclusive) | yes | `/api/billing/invoices` |
| `export_billing_history` | `period`, `from`, `to`, `preview_rows` (0-100, default 5) | yes | `/api/billing/invoices` |
| `get_receipt` | `event_id` (numeric) or `purchase_id` (UUID), one of the two | yes | `/api/billing/receipts` |
| `get_fee_info` | none | no | `/api/billing/fee-info` |

## What each returns

- `get_billing_summary`: `plan`, the tier `quotas` (for example `max_avatars` and `mcp_calls_per_day`) and live usage against them.
- `query_usage`: `period_label`, `period`, and `line_items` per billed action with count, units, gross, fee and net amounts. Omitting the period means the current month.
- `export_billing_history`: `filename`, `content_type`, the full `csv` text, and a parsed `preview`.
- `get_receipt`: a per-charge receipt for an `event_id` taken from a `query_usage` line item, or a signed purchase receipt for a `purchase_id`.
- `get_fee_info`: `fee_bps` and `fee_percent`, the platform cut on marketplace sales.

## Worked example

Request: "What did I spend in June, and can I have it as a spreadsheet?"

1. Call `query_usage` with `{ "period": "2026-06" }` and summarize the `line_items`.
2. Call `export_billing_history` with `{ "period": "2026-06" }`. Save the returned `csv` text to a file named by `filename` if the user asks for one.

## Notes

- `period` must match `YYYY-MM`. Anything else is rejected.
- Pass either `event_id` or `purchase_id` to `get_receipt`, never both.
