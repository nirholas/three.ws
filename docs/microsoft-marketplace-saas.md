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
| Billing page API, seats, refresh | [`api/_lib/microsoft-billing.js`](../api/_lib/microsoft-billing.js) |
| "Billed through Microsoft" section on `/dashboard/billing` | [`src/dashboard-next/pages/billing-microsoft.js`](../src/dashboard-next/pages/billing-microsoft.js) |
| Seats table | [`api/_lib/migrations/20261116151500_microsoft_saas_seats.sql`](../api/_lib/migrations/20261116151500_microsoft_saas_seats.sql): `microsoft_saas_seats`, plus `team_id` and `refreshed_at` on `microsoft_saas_subscriptions` |
| Tests | [`tests/microsoft-marketplace.test.js`](../tests/microsoft-marketplace.test.js), [`tests/microsoft-billing.test.js`](../tests/microsoft-billing.test.js) |

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

`users.plan` is the highest plan across every active entitlement the account holds: on-chain subscriptions that are `active` and unexpired, and Microsoft subscriptions in status `Subscribed`. A flat-rate Microsoft plan grants the account that activated it. A per-user plan (Microsoft sends a seat quantity) grants only the people holding a seat on it, see [Seats](#seats). A suspended or cancelled Microsoft subscription stops counting, and the plan falls back to whatever else the account holds, else `free`. Nothing about quotas forks for this channel.

## Webhook

`POST /api/microsoft-marketplace/webhook` is the connection webhook entered in Partner Center.

- **Caller check.** The `Authorization` bearer is an Entra token. It is verified against Microsoft's keys, and must carry the Marketplace app as the caller, the publisher tenant and the publisher app as the audience. Anything else gets 401.
- **Get Operation first.** Microsoft requires the publisher to confirm every call before acting on it. three.ws reads the operation back from the Fulfillment API and refuses with 400 when Microsoft has no such operation (`operation_not_found`) or its id, subscription or action differ from the body (`operation_mismatch`). Everything after this uses Microsoft's copy of the operation, never the body.
- **Idempotency.** Each operation id is stored once in `microsoft_saas_operations`. A redelivery of a finished operation gets the same answer without re-applying it. One that failed part-way is retried.
- **ChangePlan and ChangeQuantity** arrive `InProgress` and wait for the publisher's verdict, which is the HTTP response. A 200 accepts (Microsoft completes the change on its own after 10 seconds) and three.ws grants the new plan or seat count at once. A 400 refuses: `unknown_plan` for a Partner Center plan three.ws has no plan for, `invalid_quantity` for a seat count that is not a positive whole number, so the buyer is never billed for something that is not delivered. three.ws never PATCHes the operation.
- **Renew, Suspend, Unsubscribe and Reinstate** need only a 200. Reinstate arrives `InProgress` while the Fulfillment API still reports `Suspended`, so three.ws applies the operation on top of the subscription it reads back and restores the plan straight away. The same overlay covers the `Succeeded` follow-ups. three.ws then recomputes the plan and writes an audit entry.
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

## Managing a Microsoft-billed subscription

Customers see every Microsoft purchase on `/dashboard/billing`, in the **Billed through Microsoft** section (deep link `/dashboard/billing#bl-microsoft`, which seat notifications use). An account with no Microsoft subscription sees one line pointing to the [`/microsoft`](../pages/microsoft/index.html) hub.

### What the page shows

Each subscription card has:

- the three.ws plan the Partner Center plan grants, and the Microsoft status in plain language: `PendingFulfillmentStart` is *Waiting for activation*, `Subscribed` is *Active*, `Suspended` is *Suspended*, `Unsubscribed` is *Cancelled*, each with a sentence on what it means for the account;
- the renewal date (the term end when recurring billing is on), or the end date when it is off;
- this billing period's metered usage per dimension against the amount the plan includes. The period is the monthly window anchored on the term start, so it lines up with Microsoft's invoice. Each meter counts rows Microsoft accepted, rows still being reported, and rows it rejected or let expire (not billed);
- for per-user plans, the seat roster (see below);
- **Manage in Microsoft** links to the [Microsoft 365 admin center](https://admin.microsoft.com/Adminportal/Home?#/subscriptions) and the [Azure portal](https://portal.azure.com/#home). Microsoft's [SaaS lifecycle guide](https://learn.microsoft.com/en-us/marketplace/saas-subscription-lifecycle-management) documents both: in the Azure portal, search **SaaS** and open the subscription to change the plan or seat count, edit recurring billing, or cancel; invoices are in the admin center under **Bills & payments**;
- what suspension and cancellation do. three.ws never changes or cancels a purchase itself: plan, seat count, payment and cancellation stay with Microsoft.

The owner of the subscription sees the purchaser and beneficiary emails in full. A team admin or seat holder sees them masked (`b***r@contoso.com`).

### API

`GET /api/microsoft-marketplace/subscriptions` (session auth, `cache-control: private, no-store`) returns `{ plan, subscriptions, teams, manage_links }`. `subscriptions` holds every Microsoft subscription the user owns, holds a seat on, or administers through a linked team they own. Each entry carries the offer, plan and display name, the status and its label, tone and explanation, term dates, auto-renew, quantity, the masked or full emails, `role` (`owner`, `team_admin` or `seat_holder`), `seats` (`purchased`, `used`, and for admins `holders` and `candidates`), `period`, `usage` and `freshness`.

A row older than 10 minutes (and not cancelled) is refreshed from the Fulfillment API first. The call is capped at 5 seconds; on a timeout or error the stored row is returned with `freshness.source = "stored"` and the error, and the page says so. A change in plan, status or quantity found this way reconciles seats exactly as the webhook would.

`POST /api/microsoft-marketplace/seats` (session auth, CSRF token, rate limited) takes `{ op, subscription_id, user_id | team_id }`:

| `op` | Who | Effect |
|---|---|---|
| `assign` | owner or team admin | Gives `user_id` a seat. 409 `no_seats_left` when every purchased seat is used, 409 when the person holds a seat on another Microsoft subscription |
| `unassign` | owner or team admin, or the holder for their own seat | Frees the seat |
| `link_team` | owner | Lets members of a team the owner owns hold seats |
| `unlink_team` | owner | Removes the team; seats held only through it are freed |

### Seats

Seats exist only when Microsoft sends a quantity (a per-user plan). Flat-rate plans show no seat UI and grant the owner.

- The buyer takes the first seat at activation. Existing per-user rows were backfilled with the owner's seat by the migration.
- Eligible holders are the owner, the owner of the linked team, and its active members (`team_people`, not deactivated or SCIM-deleted). A team that is archived stops qualifying.
- A person holds at most one Microsoft seat, so each usage event belongs to one subscription.
- The quantity is enforced in the same statement that inserts the seat, so two admins cannot overfill it.
- When Microsoft lowers the quantity (a `ChangeQuantity` webhook or a refresh), the most recently assigned seats are freed first. Each person who loses a seat gets an in-app `microsoft_seat` notification (account category, always on) and their plan is recomputed. Deactivating someone in the team, a SCIM delete, or archiving the team frees their seat the same way.

Before deploying this code, apply `20261116151500_microsoft_saas_seats.sql` in production: plan recomputation reads `microsoft_saas_seats`.

## Free trials

A plan can carry a Microsoft-run free trial. Nothing about the purchase flow changes: the buyer lands on `/microsoft/activate`, signs in, and gets the plan. Microsoft bills nothing until the trial ends, then starts the paid plan on its own unless the buyer cancelled or turned recurring billing off.

### Turning a trial on (Partner Center)

In Partner Center, open the SaaS offer, then **Plan overview**, the plan, **Pricing and availability**, and tick **Free trial**. Set its length (Microsoft allows 1 to 180 days). Each plan has its own setting; publish the offer for the change to reach buyers. Microsoft's reference is [Plan a SaaS offer](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/plan-saas-offer). The price the trial converts to is the plan's normal price on the same page, and three.ws reads it from Microsoft, so there is no price to configure on our side.

### How three.ws tracks a trial

Microsoft's subscription object carries `isFreeTrial: true` while the trial runs and its `term` covers the trial window. Every resolve, webhook and refresh (`upsertSubscription` in [`api/_lib/microsoft-marketplace.js`](../api/_lib/microsoft-marketplace.js)) passes Microsoft's copy through [`api/_lib/microsoft-trial.js`](../api/_lib/microsoft-trial.js), which keeps these columns on `microsoft_saas_subscriptions` ([`20261116152500_microsoft_saas_free_trial.sql`](../api/_lib/migrations/20261116152500_microsoft_saas_free_trial.sql)):

| Column | Meaning |
|---|---|
| `is_free_trial` | Microsoft's current `isFreeTrial` |
| `trial_started_at` | First time the activated subscription was seen in trial (the term start). A purchase still waiting for activation has not started its trial |
| `trial_ends_at` | Last day of the trial (`term.endDate`). Kept after the trial so reporting can show it |
| `trial_converted_at` | Set once when `isFreeTrial` flips to false on a `Subscribed` row: the trial ended, or the buyer upgraded early |
| `trial_cancelled_at` | Set once when the subscription goes `Unsubscribed` during the trial. A cancelled trial never converts |
| `plan_price`, `plan_currency`, `plan_term_unit`, `plan_price_plan_id` | The plan's recurring price from Microsoft's `listAvailablePlans`, fetched while in trial whenever the plan changes. Null when Microsoft returns no price, and a lookup failure never blocks the resolve; the next refresh tries again |

Each transition writes one audit entry: `microsoft_marketplace:trial_started`, `trial_converted` or `trial_cancelled`.

### What the buyer sees

- **Activation page.** For a trial plan, the summary shows *Free trial, ends <date>, then <price> through Microsoft*. With no published price it names the plan instead (*then the Pro plan through Microsoft*) and never invents a figure. With recurring billing off it says the trial will not convert.
- **Banner.** On every page with the site header, a signed-in user with a running trial sees a slim notice under the header: days left, what the trial converts to, a **Manage in Microsoft** link (Azure portal SaaS list, opens in a new tab) and a link to the activation page details. It never takes focus, sits in normal flow, and the dismiss button hides it for the rest of the browser session. The code is [`src/microsoft-trial-banner.js`](../src/microsoft-trial-banner.js), loaded lazily by the nav's notifications entry only for signed-in visitors, and it reads `GET /api/microsoft-marketplace/subscriptions` (each entry carries `is_free_trial`, `trial_ends_at`, `trial_days_left`, `trial_converts_at`, `plan_price_label` and `manage_url`), cached for ten minutes in `sessionStorage`.
- **Reminders.** [`api/cron/microsoft-trial-reminders.js`](../api/cron/microsoft-trial-reminders.js) (`15 * * * *` in `vercel.json`) refreshes each running trial from Microsoft, then sends one in-app notification (`microsoft_trial_ending`, account category, also fans out to push and paired chats) and one email when seven days are left and again when one day is left. `microsoft_saas_trial_reminders` has one row per subscription and milestone, and its unique key is what makes the cron idempotent: a rerun or two overlapping ticks claim nothing new. A trial that converted or was cancelled since the last webhook is caught by the refresh and gets no reminder. An email that could not go out (email not configured, or a transport error) stays `pending` or `failed` and is retried on later ticks, at most three attempts, while the trial runs; the in-app notification is never repeated. Turning off email for account notifications skips the email and records `skipped`.

### Reporting

The internal Microsoft board (`/admin/microsoft`, [`api/_lib/microsoft-dashboard.js`](../api/_lib/microsoft-dashboard.js) `summarizeTrials`) shows trial starts, trials running and ending within seven days, conversions, cancellations during trial, and the conversion rate. The rate is conversions over trials that are decided (converted or cancelled), so trials still running do not count against it. Test subscriptions are excluded, and seats still in trial are left out of MRR.

Before deploying this code, apply `20261116152500_microsoft_saas_free_trial.sql` in production: the board and the subscriptions query read the trial columns.

## Run the lifecycle locally

`npm run microsoft:saas-e2e` runs the whole SaaS lifecycle on a developer machine against Microsoft's open-source [SaaS Fulfillment API emulator](https://github.com/microsoft/Commercial-Marketplace-SaaS-API-Emulator) before any Partner Center step. It needs the repo's Node version and nothing else: no Azure account, no database and no Partner Center offer. Network is used only on the first run, to clone the emulator from GitHub and install its packages.

What it starts:

- The emulator, pinned to commit `bb7bc63`. The first run clones and builds it into `~/.cache/three-ws/saas-emulator/<sha>`; later runs reuse that checkout. Pass `--emulator-dir <path>` to use a checkout you already built.
- The real three.ws API (`server/index.mjs`) on port 3126, with an isolated PGlite database ([`scripts/lib/isolated-db.mjs`](../scripts/lib/isolated-db.mjs)) carrying every Microsoft SaaS migration. The production database is never touched.
- A small receiver for the parts the emulator does not implement, written to Microsoft's documented contracts: the publisher token, Entra sign-in (authorize, token and signing keys for an ID token the harness signs), and the Metering `batchUsageEvent` API with all ten documented statuses. It also relays the emulator's webhook calls to the API.

The harness sets these variables for the API process only. Unset, every call goes to the Microsoft production hosts:

| Env var | What it points at |
|---|---|
| `MS_MARKETPLACE_EMULATOR=1` | Emulator mode: webhooks are accepted without the Entra bearer token and sign-in uses the base below. Refused when `NODE_ENV=production`, `K_SERVICE` or `VERCEL_ENV=production` is set: the server will not start, and every Marketplace call throws |
| `MS_MARKETPLACE_EMULATOR_LOGIN_BASE` | Stand-in for `login.microsoftonline.com`, read only in emulator mode |
| `MS_MARKETPLACE_API_BASE` | Fulfillment API base (default `https://marketplaceapi.microsoft.com/api`) |
| `MS_MARKETPLACE_METERING_BASE` | Metering API base (default the same host) |
| `MS_MARKETPLACE_TOKEN_URL` | Publisher token endpoint (default the tenant's `login.microsoftonline.com` token URL) |

The 23 steps cover purchase and activation, a sign-in from the wrong tenant, ChangePlan accepted and refused (a plan three.ws does not sell), ChangeQuantity with the owner taking the first seat, Suspend, Reinstate, Renew, webhook redelivery, five metering runs (batches of at most 25, a suspended subscription that records nothing, Duplicate settlement keeping the accepted event id, an idempotent rerun), the remaining metering error statuses, Unsubscribe, and a final check that every operation is in `microsoft_saas_operations`. Each step prints `PASS` or `FAIL` with its evidence, and the command exits non-zero on any failure. `--verbose` also streams the emulator and API logs.

## Testing against preview

Partner Center's preview audience lets an allow-listed tenant buy the offer without being charged. Microsoft marks such subscriptions `isTest`, and three.ws stores that flag. Run the test plan in the [plan doc](./microsoft-marketplace-offer-plan.md#test-plan):

- purchase and activate
- change the plan and the quantity
- suspend, reinstate and cancel

Then check each step in `microsoft_saas_operations` and on `/microsoft/activate`. Run the unit suite with `npx vitest run tests/microsoft-marketplace.test.js`.
