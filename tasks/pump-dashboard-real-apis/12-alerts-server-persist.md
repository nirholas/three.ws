# 12 — Alerts page: persist alert config server-side and deliver real notifications

## Problem
[pump-dashboard.html](../../pump-dashboard.html) `saveAlertConfig()` (lines ~1455–1467) writes to `localStorage` only. Alerts therefore:
- Don't survive a different browser / device.
- Are evaluated only against the WebSocket events the **current tab** happens to receive — if the user closes the tab, no alert ever fires again.
- Have no delivery channel — they show up only in the local "Alert History" feed.

For a "Pump bot" dashboard, alerts that exist only while a tab is open are not real alerts.

## Outcome
Alert config is stored per-user in Postgres and edited via a real API. A backend evaluator (running in [workers/](../../workers/) — there is already a worker process here) consumes the same Pump.fun event stream the bot already monitors, matches it against each user's alert rules, and delivers via:
- An in-app notification row in `/api/notifications` (already exists — see [api/notifications/index.js](../../api/notifications/index.js)).
- Optionally, the user's webhook URL (per-rule), if set.

The frontend now reads/writes via the new endpoints; `localStorage` is only a render cache.

## Endpoints (new, real)
- `GET /api/alerts/config` → returns the signed-in user's alert config row.
- `PUT /api/alerts/config` body `{ graduation, whale, fees, launch, whaleThreshold, claimThreshold, cooldown, webhookUrl? }` → upserts.

## Implementation
1. Migration in [migrations/](../../migrations/): create `user_alert_configs (user_id PK, graduation bool, whale bool, fees bool, launch bool, whale_threshold numeric, claim_threshold numeric, cooldown_seconds int, webhook_url text, updated_at timestamptz)`.
2. Add `api/alerts/config.js` (Vercel function) implementing GET/PUT with the existing `getSessionUser` auth helper from [api/_lib/auth.js](../../api/_lib/auth.js). Validate via `zod`; never trust client-supplied fields.
3. Backend evaluator: extend the existing pump.fun event consumer in [workers/](../../workers/) (find the worker that currently subscribes to PumpPortal — look for `subscribeNewToken`/`subscribeMigration`). For each inbound event, query active `user_alert_configs` rows whose rules match the event, insert into `notifications`, and POST to `webhook_url` if set. Honor `cooldown_seconds` per (user_id, rule_type) pair using a real Postgres timestamp check or Upstash Redis (already a dependency — see [api/_lib/rate-limit.js](../../api/_lib/rate-limit.js)).
4. In [pump-dashboard.html](../../pump-dashboard.html):
   - On nav into `#page-alerts`, call `GET /api/alerts/config` and populate the form. While loading, disable inputs.
   - On Save, `PUT /api/alerts/config` with the current form values. On 200, also write to `localStorage` for fast re-render. On error, surface upstream error via toast. The "Saved settings" toast must only fire after a real 2xx.
   - Add a `Webhook URL` field next to Thresholds (optional, validate as `https://` URL on the client; the server re-validates).
   - The "Alert History" feed continues to show the local matches (so the user gets immediate feedback when their tab is open) **and** also fetches recent server-delivered alerts via `GET /api/notifications?type=pump_alert&limit=50` so it's authoritative across sessions.

## Definition of done
- Save settings on machine A → open the dashboard on machine B with the same account → settings render as saved.
- Close the dashboard tab; trigger a real graduation event in the upstream feed (or wait for one in production); observe a row in `notifications` for that user and (if webhook configured) a real POST to the webhook.
- `localStorage` is only a render cache: deleting the `pumpbot-alerts` key and reloading still shows the saved settings (because they came from the API).
- `npm test` green; **completionist** subagent run on changed files.
