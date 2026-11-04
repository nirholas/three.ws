# Microsoft Marketplace SaaS offer

How three.ws sells its plans through Microsoft Marketplace: a buyer purchases on Microsoft's invoice, lands on three.ws, and signs in with Microsoft Entra ID. That links the purchase to a three.ws account and grants the plan. Microsoft then drives plan changes, renewals, suspension and cancellation through a webhook, and three.ws reports metered usage back every hour. This is item #1 of the [Microsoft distribution plan](./microsoft-marketplace-offer-plan.md), whose owner checklist (steps 4 to 13) covers the Partner Center side.

Production stays on Google Cloud. The offer uses Microsoft's SaaS Fulfillment API v2 and Metering API, which work from any host.

## Pieces

| Piece | Path |
|---|---|
| Fulfillment and Metering client, Entra sign-in, entitlement rules | [`api/_lib/microsoft-marketplace.js`](../api/_lib/microsoft-marketplace.js) |
| Landing page API, sign-in and webhook | [`api/microsoft-marketplace/[action].js`](../api/microsoft-marketplace/[action].js) |
| Hourly metering cron | [`api/cron/microsoft-metering.js`](../api/cron/microsoft-metering.js) (`7 * * * *` in `vercel.json`, synced to Cloud Scheduler) |
| Landing page | `/microsoft/activate`: [`pages/microsoft-activate.html`](../pages/microsoft-activate.html), [`src/microsoft-activate.js`](../src/microsoft-activate.js) |
| Offer id, plan map, metered dimensions | [`data/microsoft-marketplace.json`](../data/microsoft-marketplace.json) |
| Tables | [`api/_lib/migrations/20261104180000_microsoft_marketplace_saas.sql`](../api/_lib/migrations/20261104180000_microsoft_marketplace_saas.sql): `microsoft_saas_subscriptions`, `microsoft_saas_operations`, `microsoft_saas_usage_events` |
| Tests | [`tests/microsoft-marketplace.test.js`](../tests/microsoft-marketplace.test.js) |

## Configuration

| Env var (Cloud Run) | What it is |
|---|---|
| `MS_MARKETPLACE_TENANT_ID` | The publisher's Entra tenant id |
| `MS_MARKETPLACE_CLIENT_ID` | The single-tenant publisher app entered in Partner Center technical configuration. It calls the Fulfillment and Metering APIs |
| `MS_MARKETPLACE_CLIENT_SECRET` | That app's client secret |
| `MS_ENTRA_SSO_CLIENT_ID` | The multitenant app buyers sign in with. Redirect URI `https://three.ws/api/microsoft-marketplace/sso/callback` |
| `MS_ENTRA_SSO_CLIENT_SECRET` | That app's client secret |

`GET /api/microsoft-marketplace/status` returns `{ ready, sso, missing }`, and `missing` names the variables a deployment still lacks. Until all five are set, the landing page explains that purchases are not switched on and stay unbilled, and the metering cron skips. Set them with `gcloud run services update three-ws-api --region us-central1 --update-env-vars ...`.

Plans and dimensions live in `data/microsoft-marketplace.json`:

- `plans` maps each Partner Center plan id to a three.ws plan (`pro`, `team`, `enterprise`, the same plans as [`api/subscriptions/plans.js`](../api/subscriptions/plans.js)).
- `dimensions` declares each metered dimension and the `usage_events.kind` it counts:
  - `mcp_tool_calls` counts `tool_call`
  - `agent_messages` counts `llm`

A dimension must be declared on the plan in Partner Center before Microsoft accepts usage for it.

## Purchase flow

1. Microsoft sends the buyer to `https://three.ws/microsoft/activate?token=...`.
2. The page posts the token to `POST /api/microsoft-marketplace/resolve`. The server resolves it with Microsoft, stores the subscription from Microsoft's own copy, and pins it to this browser in a signed, one-hour cookie. The page shows the plan, the beneficiary and the status.
3. **Continue with Microsoft** starts `GET /api/microsoft-marketplace/sso/start`: Entra authorization code with PKCE, a nonce, and the `openid profile email` scopes.
4. `GET /api/microsoft-marketplace/sso/callback` handles the return:
   - verifies the ID token against Microsoft's keys, the nonce and the audience
   - checks the signed-in tenant is the subscription's beneficiary or purchaser tenant
   - finds the account linked to that Entra identity (subject `tid:oid`), else uses the account signed in on this browser, else creates one
   - links the subscription, activates it with Microsoft, and recomputes the account's plan
5. The page reloads into its activated state. Every failure lands on `/microsoft/activate?error=<code>`, which says what went wrong and how to recover. The codes are listed in `ERRORS` in `src/microsoft-activate.js`, for example `tenant_mismatch`, `already_linked`, `admin_consent_required` and `activation_failed`.

Microsoft sign-in on `/login` uses the same Entra app. It only signs in an identity that a purchase already linked, so it never creates stray accounts.

## Entitlement

`users.plan` is the highest plan across every active entitlement the account holds: on-chain subscriptions that are `active` and unexpired, and Microsoft subscriptions in status `Subscribed`. A suspended or cancelled Microsoft subscription stops counting, and the plan falls back to whatever else the account holds, else `free`. Nothing about quotas forks for this channel.

## Webhook

`POST /api/microsoft-marketplace/webhook` is the connection webhook entered in Partner Center.

- **Caller check.** The `Authorization` bearer is an Entra token. It is verified against Microsoft's keys, and must carry the Marketplace app as the caller, the publisher tenant and the publisher app as the audience. Anything else gets 401.
- **Idempotency.** Each operation id is stored once in `microsoft_saas_operations`. A redelivery of a finished operation answers 200 without re-applying it. One that failed part-way is retried.
- **ChangePlan, ChangeQuantity and Reinstate** arrive `InProgress` and wait for the publisher's verdict. three.ws acknowledges `Success` when it can serve the target plan and `Failure` for a plan id it does not know, so the buyer is never billed for something that is not delivered.
- **Renew, Suspend, Unsubscribe** and the `Succeeded` follow-ups are already applied by Microsoft. three.ws re-reads the subscription from the Fulfillment API (it never trusts the body), mirrors it, recomputes the plan and writes an audit entry.
- A failure while applying returns 502, so Microsoft redelivers.

## Metering

Every hour the cron meters each `Subscribed`, linked subscription:

1. It works out the completed hours not yet metered. That is the hour after `metered_through`, or the activation hour, up to the last full hour, never further back than 23 hours (Microsoft accepts usage up to 24 hours old).
2. It counts the account's `usage_events` with status `ok` in each hour, for each dimension. A failed call is never billed.
3. It stores one `microsoft_saas_usage_events` row per subscription, dimension and hour. The unique key is Microsoft's own duplicate rule, so a rerun never double counts. `metered_through` advances only after the rows are stored.
4. It posts pending rows to `/batchUsageEvent` in batches of 25 and settles each row from Microsoft's per-event verdict:

| Microsoft status | Row becomes | Why |
|---|---|---|
| `Accepted`, `Duplicate` | `accepted` | Billed (a duplicate was already billed) |
| `Expired` | `expired` | Outside the 24 hour window; cannot be billed |
| `Error`, `ResourceNotActive` | stays `pending`, `attempts + 1` | Transient: Microsoft's own error, or a subscription not active yet. Retried next hour |
| anything else (`InvalidDimension`, `InvalidQuantity`, ...) | `rejected` | Needs a fix in Partner Center or the dimension map. An ops alert names the first reason |

A batch that fails to post (a network error or a 5xx) also stays pending and is retried. A pending row that is still unaccepted after the window is settled `expired`. Microsoft subtracts each plan's included quantity itself, so the raw hourly count is what gets reported.

## Testing against preview

Partner Center's preview audience lets an allow-listed tenant buy the offer without being charged. Microsoft marks such subscriptions `isTest`, and three.ws stores that flag. Run the test plan in the [plan doc](./microsoft-marketplace-offer-plan.md#test-plan):

- purchase and activate
- change the plan and the quantity
- suspend, reinstate and cancel

Then check each step in `microsoft_saas_operations` and on `/microsoft/activate`. Run the unit suite with `npx vitest run tests/microsoft-marketplace.test.js`.
