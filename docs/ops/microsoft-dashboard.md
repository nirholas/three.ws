# Microsoft partnership operations board

Internal board at **`/admin/microsoft`** for every Microsoft surface three.ws runs: Marketplace SaaS subscriptions and metering, the Teams bot, the Power Platform connector, Partner Center analytics and the alert incidents. It is not linked from public navigation and is not listed in `data/pages.json`.

- Page: [pages/microsoft-admin.html](../../pages/microsoft-admin.html), [src/microsoft-admin.js](../../src/microsoft-admin.js), [src/microsoft-admin.css](../../src/microsoft-admin.css)
- Data API: `GET /api/admin/microsoft` ([api/admin/microsoft.js](../../api/admin/microsoft.js)). It needs an admin session or the `x-ops-secret` header (`OPS_SECRET`), via [api/_lib/ops-auth.js](../../api/_lib/ops-auth.js). It is open in local dev only when `OPS_SECRET` is unset.
- Aggregation: [api/_lib/microsoft-dashboard.js](../../api/_lib/microsoft-dashboard.js) (pure functions, tested in [tests/microsoft-dashboard.test.js](../../tests/microsoft-dashboard.test.js))
- Alerts: [api/cron/microsoft-alerts.js](../../api/cron/microsoft-alerts.js) runs every 5 minutes, with logic in [api/_lib/microsoft-alerts.js](../../api/_lib/microsoft-alerts.js) (tests: [tests/microsoft-alerts.test.js](../../tests/microsoft-alerts.test.js))
- Partner Center ingest: [api/cron/microsoft-partner-center.js](../../api/cron/microsoft-partner-center.js) runs daily at 06:17 UTC, with logic in [api/_lib/microsoft-partner-center.js](../../api/_lib/microsoft-partner-center.js) (tests: [tests/microsoft-partner-center.test.js](../../tests/microsoft-partner-center.test.js))
- Instrumentation: [api/_lib/microsoft-surface-events.js](../../api/_lib/microsoft-surface-events.js)
- Migration: `20261111160517_microsoft_partnership_ops.sql`

Both crons are in the `vercel.json` `crons` array. Run `node scripts/create-gcp-scheduler.mjs` after a deploy to create their Cloud Scheduler jobs.

## Metrics and where each comes from

| Panel / metric | Source table | Window | How it is computed |
|---|---|---|---|
| MRR | `microsoft_saas_subscriptions` x `data/plans.json` `price_usd` | now | For each non-test `Subscribed` row: the list price of the three.ws plan its Microsoft plan maps to (`data/microsoft-marketplace.json`), times `max(quantity, 1)`. |
| Subscriptions by status and plan | `microsoft_saas_subscriptions` | all time | Counted by `saas_status` and `plan_id`. Rows with `is_test` are excluded and counted separately. |
| Webhook operations, failures | `microsoft_saas_operations` | 7 days | Counted by action and outcome. A failure is `outcome = 'failed'`. The series shows a daily total with failures stacked on top. |
| Unacknowledged / late acks | `microsoft_saas_operations` | 7 days | An `InProgress` ChangePlan, ChangeQuantity or Reinstate not acknowledged within 10 s, or any row still at `received` after 60 s. A late ack is one acknowledged after 10 s. |
| Metering verdicts | `microsoft_saas_usage_events` | 7 days by `effective_start_time`, plus any rejected/expired row updated in 7 days | `accepted` / `duplicate` (Microsoft answered Duplicate, stored as accepted with message `Duplicate`) / `expired` / `rejected` / `pending`. The last error is the newest rejected, expired or retried-pending row. |
| Teams conversations, tenants | `microsoft_surface_events` (`surface = 'teams_bot'`) | 30 days (tenants active in 7 days) | Distinct `conversation_id` and `tenant_id`. |
| Message extension and card actions | `microsoft_surface_events` (`teams_bot`) | 7 days | `composeExtension/query` counts as a search. `queryLink` / `anonymousQueryLink` count as unfurls. `adaptiveCard/action`, `submitAction`, `selectItem` and `fetchTask` count as card actions. 401/403 count as unverified. |
| Connector calls, error rate | `microsoft_surface_events` (`surface = 'power_platform'`) | 7 days (series 30) | Calls carrying the connector's `X-Threews-Client` header, by operation. Error rate is the share of 5xx; 4xx is shown separately. p95 latency is per operation. |
| Partner Center analytics | `microsoft_partner_center_reports`, `microsoft_partner_center_rows` | all ingested | Rows, distinct customers, revenue and latest event date per dataset (orders, usage, customers), plus the last ingest and any error. |
| Alert incidents | `microsoft_alert_incidents` | open, plus resolved in 30 days | One row per incident key. |
| Store / Edge installs | none | n/a | No table records Microsoft Store or Edge Add-ons installs. Read acquisitions in Partner Center (Apps and games > Analytics). |

Surface events record no message text: only operation, status, latency, tenant/conversation (Teams) or OAuth client/user (connector). The alert cron prunes rows older than 180 days on its 04:00 UTC tick. The board reads at most the newest 50,000 rows in 30 days and shows a notice if it hits that cap.

## Alerts

The alert cron checks four conditions. Each active condition is an incident with a stable key:

| Key | Fires when |
|---|---|
| `webhook_unacknowledged:<operation id>` | An operation is unacknowledged past Microsoft's deadline, or stuck at `received` (7-day lookback) |
| `metering_rejected:<subscription>:<dimension>` | Microsoft rejected a usage event in the last 24 h |
| `connector_error_rate` | The connector 5xx rate in the last hour is over `MS_ALERT_CONNECTOR_ERROR_RATE` (default `0.05`), with at least `MS_ALERT_CONNECTOR_MIN_CALLS` (default `20`) calls |
| `teams_5xx` | The Teams bot answered 5xx in the last 15 minutes |

**Dedup:** a newly active key opens a row in `microsoft_alert_incidents` and sends exactly one message through `sendOpsAlert`, at critical severity with signature `microsoft:<key>`. The message always goes to the `ops_alerts` table, plus Telegram (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_ALERTS_CHAT_ID`) and email (`OPS_ALERT_EMAILS` + `RESEND_API_KEY`) when configured. While the key stays active, later ticks only bump `occurrences`. When it clears, the incident is resolved, and only a later recurrence sends again. The open is a conditional upsert, so overlapping cron runs cannot double-send.

Read unacknowledged alert rows with `select * from ops_alerts where acknowledged_at is null order by last_seen desc;`.

## Runbook

Each section below is linked from the board's "What to do" button and from the alert message.

### Webhook unacknowledged

Microsoft sent an `InProgress` ChangePlan, ChangeQuantity or Reinstate, and three.ws did not PATCH the operation back within 10 s. Microsoft then decides on its own (typically accepting the change), which can leave the plan in three.ws out of step. A row stuck at `received` means the handler died before recording an outcome.

1. Open the record on the board. Note `operation`, `subscription_id` and `received_at`.
2. Check the API logs around `received_at` for `/api/microsoft-marketplace/webhook` (`npm run logs`).
3. Read Microsoft's view with the helpers in [api/_lib/microsoft-marketplace.js](../../api/_lib/microsoft-marketplace.js), using the production env: `getSubscription(subscriptionId)` and `getOperation(subscriptionId, operationId)`. Compare plan and quantity with `microsoft_saas_subscriptions`. If they differ, apply Microsoft's values to the row and to the account's plan.
4. If the operation is still `InProgress` at Microsoft, call `acknowledgeOperation(subscriptionId, operationId, 'Success')` (or `'Failure'` to refuse the change). If it is already settled, set the row's `outcome` to match what Microsoft applied, so the incident clears.

### Webhook failed

The handler recorded `outcome = 'failed'`, with the error on the row. Common causes: the subscription is unknown (the purchase never resolved), the database write failed, or Microsoft's API refused the ack. Fix the cause shown in `error`, then reconcile the subscription as in step 3 above.

### Metering rejected

Microsoft refused a usage event. The message usually names the cause: an unknown dimension (the dimension id is not on the plan in Partner Center), a subscription that is not active, a quantity or time outside the rules, or bad credentials. Fix the plan's dimensions in Partner Center or the dimension map in `data/microsoft-marketplace.json`. A rejected event is not retried automatically. Once the cause is fixed, set its status back to `pending` so the hourly metering cron resubmits it, but only while it is still inside Microsoft's 24 h window.

### Metering expired

The event was not accepted inside Microsoft's 24 hour window, so that usage is unbilled. Check that `/api/cron/microsoft-metering` ran every hour (Cloud Scheduler job history) and that `MS_MARKETPLACE_*` credentials were valid during the gap. Expired usage cannot be resubmitted.

### Teams 5xx

The Teams bot answered a 5xx, so the user saw an error in Teams. The record names the operation and the error. Check the API logs for `/api/microsoft-teams/messages` at that time. The usual causes are a database timeout, an upstream model or generation error, or missing `MS_TEAMS_BOT_APP_ID` / bot credentials. The incident clears 15 minutes after the last 5xx.

### Connector error rate

Power Platform connector calls are failing with 5xx above the threshold. The alert names the worst operation. Check that operation's endpoint (`/api/agents`, `/api/agents/public`, `/api/agents/talk` or `/api/3d/studio`) in the logs. 4xx responses (expired sign-in, bad input) are not counted. Tune the threshold with `MS_ALERT_CONNECTOR_ERROR_RATE` and `MS_ALERT_CONNECTOR_MIN_CALLS` on the Cloud Run service (`gcloud run services update three-ws-api --region us-central1 --update-env-vars ...`).

### Unmapped plan

A subscription is `Subscribed` on a Microsoft plan id that `data/microsoft-marketplace.json` does not map to a three.ws plan, so it earns no MRR and may not unlock the right features. Add the mapping, deploy, and confirm the account's plan.

### Pending activation

The buyer purchased but has not finished the landing page (`/microsoft/activate`) after 24 hours, so Microsoft has not started billing. Contact the buyer through the lead or customer record in Partner Center, and point them back to the landing page link in their purchase email.

### Partner Center ingest

The daily ingest failed for a dataset, and the error is shown. A 401 or 403 means the Entra app behind `MS_MARKETPLACE_CLIENT_ID` has not been added in Partner Center. To add it: Partner Center > Account settings > User management > Microsoft Entra applications, then add the app with the **Manager** role. On its first run the cron schedules one daily CSV report per dataset, on Microsoft's system queries (ISVOrder, ISVUsage, ISVCustomer). Rows appear after Microsoft's first execution, usually within a day. Personal contact fields (names, emails) are dropped before storage.

### Configuration

The board lists missing `MS_MARKETPLACE_TENANT_ID`, `MS_MARKETPLACE_CLIENT_ID`, `MS_MARKETPLACE_CLIENT_SECRET`, `MS_ENTRA_SSO_CLIENT_ID` and `MS_ENTRA_SSO_CLIENT_SECRET`. Set them on the Cloud Run service with `--update-env-vars` (never `--set-env-vars`, which replaces the whole set). See [docs/microsoft-marketplace-saas.md](../microsoft-marketplace-saas.md).

---

Microsoft, Microsoft Teams, Power Platform, Power Automate, Microsoft Edge and Partner Center are trademarks of the Microsoft group of companies.
