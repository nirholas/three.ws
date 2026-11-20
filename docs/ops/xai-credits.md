# xAI credit ledger

three.ws holds xAI credits through the Grok for Startups program. The grant is one balance (released in two tranches) and it expires six months after issue, so unspent credit is lost. This ledger shows where the credit goes and warns before it runs out or expires unused.

## What is recorded

Every runtime call to `api.x.ai` made with the platform's own `GROK_API_KEY` writes one row to `xai_usage` through `recordXaiUsage` in `api/_lib/xai-usage.js`. Calls made with a user's own key are never recorded. Writes are buffered (1 second flush, 5000 row cap), never block the request, and are logged and dropped if the database write fails.

| Column | Meaning |
|---|---|
| `lane` | `chat`, `image`, `video`, `voice`, `eval`, `mention-bot` or `other` |
| `model`, `request_id` | model id and xAI response id |
| `input_tokens`, `output_tokens`, `cached_tokens`, `reasoning_tokens` | from the usage object (chat completions and Responses API shapes) |
| `units` | images, video seconds or voice minutes for media lanes |
| `cost_usd_micro` | cost in millionths of a dollar |
| `cost_source` | `api` when xAI reports `cost_in_usd_ticks`, else `price_table` |

Call sites instrumented: `api/_lib/llm.js`, `api/_lib/llm-tool-chain.js`, `api/chat.js`, `api/widgets/[id]/[action].js`, `api/_lib/x-search.js`. A new xAI call site calls `recordXaiUsage` with its lane; see the header of `xai-usage.js`.

Prices live in `api/_lib/chat-models.js` (`GROK_MODELS`, `XAI_MEDIA_MODELS`) and are applied by `api/_lib/xai-pricing.js`. A test fails when any listed model is unpriced. Prompts of 200k tokens or more are billed at 2x.

## Report

```
npm run grok:usage                 # local DATABASE_URL
npm run grok:usage -- --prod-env   # production DATABASE_URL and XAI_* from the Cloud Run service
npm run grok:usage -- --reconcile  # also compare 30 day ledger spend to xAI's billing usage
```

The report shows spend by lane and model for 24 hours, 7 days and 30 days, remaining credit, burn rate, runway and expiry. `--reconcile` needs `XAI_MANAGEMENT_KEY` and `XAI_TEAM_ID`. Exit codes: 0 ok, 1 warn or reconcile drift, 2 fail.

## Configuration (names only)

| Variable | Purpose |
|---|---|
| `XAI_CREDIT_GRANT_USD` | total grant in USD |
| `XAI_CREDIT_ISSUED_AT` | ISO date the grant was issued (expiry is six months later) |
| `XAI_CREDIT_SECOND_TRANCHE_AT` | ISO date the second tranche was released |
| `XAI_DAILY_SPEND_CAP_USD` | 24 hour spend that turns the check to fail |
| `XAI_MANAGEMENT_KEY`, `XAI_TEAM_ID` | xAI management API credentials for `--reconcile` |

The grant amount and dates are set only on the Cloud Run service, with `--update-env-vars` (never `--set-env-vars`, which replaces the whole env set). They never land in git, `.env.example` or docs.

## Health check

`/api/healthz` carries an advisory `xai-credits` subsystem from `api/_lib/xai-credit-health.js`. It shows only a status and day counts, never the grant amount.

| Status | Condition |
|---|---|
| fail | 24 hour spend over `XAI_DAILY_SPEND_CAP_USD`, or the grant is spent |
| warn | runway under 14 days and before expiry; or 30 days or fewer to expiry with more than 40% unspent; or expired with credit left |
| unknown | grant env vars unset, or the ledger is unreadable |

Thresholds are the constants at the top of `xai-credit-health.js` (`RUNWAY_WARN_DAYS`, `WASTE_WARN_DAYS`, `WASTE_WARN_UNSPENT`, `BURN_WINDOW_DAYS`). Burn rate is the average over the last 7 days.

## Proof without production

`node scripts/xai-usage-live-check.mjs` applies the migration stream to a throwaway Postgres, records calls through the real recorder and prints the report and healthz subsystem.
