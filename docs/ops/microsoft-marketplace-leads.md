# Microsoft Marketplace leads

Microsoft Partner Center sends a lead every time someone acts on the three.ws listing (Get it now, Contact me, Free trial, a portal search hit). three.ws takes each lead in, stores it, tells the admins once, and drafts a reply grounded in the offer. **Drafts are never sent automatically.** A person reads the draft, edits it, sends it from their own mailbox and then marks the lead contacted.

| Piece | Path |
| --- | --- |
| Receiver (Partner Center posts here) | [api/microsoft-marketplace/leads.js](../../api/microsoft-marketplace/leads.js) `→ POST /api/microsoft-marketplace/leads/<token>` |
| Validation, storage, notification, drafting, retention | [api/_lib/microsoft-leads.js](../../api/_lib/microsoft-leads.js) |
| Admin API | [api/ops/microsoft-leads.js](../../api/ops/microsoft-leads.js) `→ /api/ops/microsoft-leads` |
| Admin view | [pages/microsoft-leads-admin.html](../../pages/microsoft-leads-admin.html) + [src/microsoft-leads-admin.js](../../src/microsoft-leads-admin.js) `→ /admin/microsoft/leads` |
| Cron (every 10 minutes) | [api/cron/microsoft-leads.js](../../api/cron/microsoft-leads.js) `→ /api/cron/microsoft-leads` |
| Table | `microsoft_marketplace_leads`, migration `api/_lib/migrations/20261111160847_microsoft_marketplace_leads.sql` |
| Tests | [tests/microsoft-marketplace-leads.test.js](../../tests/microsoft-marketplace-leads.test.js), [tests/microsoft-leads-draft.test.js](../../tests/microsoft-leads-draft.test.js) |

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `MS_MARKETPLACE_LEADS_TOKEN` | Yes | Shared secret that is part of the lead URL. At least 32 characters of `A-Z a-z 0-9 _ -`. Generate one with `node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"`. Without it the receiver answers 503 `leads_not_configured`. |
| `TELEGRAM_ALERTS_CHAT_ID` (with the existing `TELEGRAM_BOT_TOKEN`) | No | Also posts each lead to the ops Telegram chat. |
| `OPS_ALERT_EMAILS` (with the existing `RESEND_API_KEY`) | No | Also emails each lead to these comma-separated addresses. |

Set them on Cloud Run with `--update-env-vars` (never `--set-env-vars`, which replaces the whole env set):

```sh
gcloud run services update three-ws-api --region us-central1 \
  --update-env-vars MS_MARKETPLACE_LEADS_TOKEN=<token>
```

## Partner Center setup (owner step)

Partner Center offers no request signing for HTTPS lead destinations, so the token in the URL is the authentication. Treat the full URL as a secret.

1. Deploy the receiver and set `MS_MARKETPLACE_LEADS_TOKEN` on Cloud Run (above).
2. Sign in to [Partner Center](https://partner.microsoft.com/dashboard) and open **Marketplace offers**, then the three.ws offer.
3. Open **Offer setup** and scroll to **Customer leads**. Select **Connect**.
4. In **Connection details**, set **Lead destination** to **HTTPS endpoint**.
5. Set **HTTPS endpoint URL** to `https://three.ws/api/microsoft-marketplace/leads/<token>`, with `<token>` exactly equal to the Cloud Run value.
6. Enter a **Contact email** for Microsoft's notices about failed deliveries, then select **Validate**. Partner Center posts a test lead. It is stored like any other lead and appears in the admin view with the offer title Partner Center sends; mark it closed.
7. Select **OK**, then **Save draft**, and republish the offer so the destination takes effect.

The same URL serves every offer (the SaaS offer and any Teams or Microsoft 365 app listing with leads enabled). The offer is recorded per lead from `LeadSource`.

### Rotating the token

Generate a new token, set it on Cloud Run, then update the URL in Partner Center and select **Validate** again. Leads posted to the old URL between the two steps are rejected with 401 and Microsoft retries them, so do both steps back to back.

## What happens to a lead

1. **Receive.** The route is rate limited per IP (60 per 10 minutes), checks the token in constant time, and validates the body against Partner Center's HTTPS schema (`UserDetails`, `LeadSource`, `ActionCode`, `OfferTitle`, `Description`). A bad token gets 401, a bad body 400 with the first schema error.
2. **Store, exactly once.** Partner Center sends no lead id, so the dedupe key is a hash of the canonical payload. A retried delivery returns 200 `{duplicate: true}` and does nothing else.
3. **Notify, once.** Every admin gets one in-app notification carrying name, company, source, action and a link to the lead in the admin view. Nothing else (no email address, phone or message text) goes into a notification. Telegram and email are added when configured.
4. **Draft.** An LLM writes a reply from the offer title, the lead type, the person's own message and the approved Microsoft wording ("three.ws and Microsoft have announced a partnership", "three.ws is live on Microsoft Marketplace"). It never claims a partner tier, certification or co-sell status. A draft that comes back empty, mostly non-Latin, under 200 characters or without the product name is rejected, and drafting fails over to a different provider family.
5. **Respond.** The receiver answers within about 15 seconds. The inline draft gets 12 seconds; if it misses, the lead is already stored and notified and the draft is left pending.
6. **Back-fill.** The cron re-sends any notification that did not go out and drafts any pending or failed lead (four per tick, up to five attempts each). A failed draft shows a **Retry** button in the admin view. Redrafting a lead that already has a draft keeps the old one if the new attempt fails.

## The admin view

`/admin/microsoft/leads` is limited to admins (`users.is_admin` or a wallet in `ADMIN_ADDRESSES`).

- Tabs by status (new, contacted, qualified, closed) with counts, plus source and action filters and a search over name, company and email.
- Detail: lead facts, the raw payload, the draft with **Copy** (subject and body) and **Draft again**, a status selector, **Mark contacted**, and private notes.
- Links from notifications open the lead directly (`?id=`).

## What to do with each lead type

The action is the part of `LeadSource` before the pipe (`AzureMarketplace-PLT|...`) or `ActionCode`.

| Action | Meaning | What to do |
| --- | --- | --- |
| `PLT` | Contact me / Request a demo | Reply within 24 hours; the admin view flags it. Copy the draft, edit it to answer their message, send it from the owner mailbox, then **Mark contacted**. Move to qualified once a call is booked. |
| `INS` | Get it now / install | They have started a purchase or install. Reply with a short welcome, the activation link (`https://three.ws/microsoft/activate`) and an offer to help with setup. Mark contacted. |
| `Create` | Free trial or subscription created | Check that the subscription activated on three.ws (see [docs/microsoft-marketplace-saas.md](../microsoft-marketplace-saas.md)). Send an onboarding note with the first steps. Mark contacted. |
| `DNC` | Do not contact | Do not reply or add them to any list. Close the lead. Drafting is disabled for it, and its personal details are deleted after 30 days. |

Sources: `AzureMarketplace` (marketplace.microsoft.com), `AzurePortal` (Azure portal search) and `AppSource (SPZA)` (the business apps store and Teams listings). The handling is the same for each source.

## Retention

The cron redacts leads on these schedules: names, email, phone, job title, the free-text message, the draft and owner notes are cleared. Company, country, source, action, offer and dates stay as aggregate history.

| Lead | Personal details kept for |
| --- | --- |
| `DNC` | 30 days from receipt |
| Closed | 365 days from the day it was closed |
| Any other | 730 days from receipt at most |

A redacted lead cannot be redrafted. To erase a lead immediately on request, close it and run `update microsoft_marketplace_leads set received_at = now() - interval '731 days' where id = '<id>'`; the next cron tick redacts it.

## Troubleshooting

- **Partner Center Validate fails**: call the URL yourself with a test body. 503 means the token is not set on Cloud Run, 401 means the URL token does not match it, 404 means the route is not deployed yet.
- **Leads arrive but no notification**: check `notify_channels` on the row. `admins: 0` means no user has `is_admin`; the cron retries every 10 minutes.
- **Drafts stuck on failed**: the free LLM lanes are down. `draft_error` on the row has the reason. **Retry** in the admin view, or wait for the cron.
