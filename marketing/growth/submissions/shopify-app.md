# Shopify app submission: Photo to 3D product media

Target: [Shopify Partner Dashboard](https://partners.shopify.com) (register
the app) and, once live, the
[Shopify App Store listing requirements](https://shopify.dev/docs/apps/launch/app-requirements-checklist).

Ready for owner order 939. Built and tested in work order 091; the Partner
account, development store, env vars, and App Store submission are owner
actions (CLAUDE.md gate 2 and the "Never blocked" rule for a step that needs
a third-party account only the owner can create). This Evolve session
confirmed no Shopify Partner app exists in production yet:
`node scripts/read-service-env.mjs '^SHOPIFY' --names` returns zero matches,
so `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, and the
build-time `VITE_SHOPIFY_API_KEY` are all unset.

## What ships

- `api/shopify/install.js`, `api/shopify/callback.js`,
  `api/_lib/shopify/hmac.js`: the OAuth authorization-code flow, query-string
  HMAC verification, offline access-token exchange, and mandatory-webhook
  registration on install.
- `api/_lib/shopify/session-token.js`, `api/_lib/shopify/auth-request.js`:
  embedded-request authentication (HS256 session-token JWTs matched to the
  shop's stored offline token).
- `pages/shopify-app.html` + `src/shopify-app/app.js`: the embedded admin UI
  (App Bridge CDN script, no `@shopify/app-bridge` npm dependency), listing
  products, generating and previewing a model with `<model-viewer>`, bulk
  mode with real per-item status, and a billing banner.
- `api/shopify/products.js`, `api/_lib/shopify/media.js` (`listProducts`): the
  shop's product list via Admin GraphQL, with each product's existing
  3D-model state already computed server-side.
- `api/shopify/media/create.js`, `api/shopify/media/status.js`,
  `api/shopify/media/attach.js`, `api/_lib/shopify/media.js`: photo to GLB via
  three.ws's own `/api/forge` pipeline, staged upload, and
  `productCreateMedia` with `mediaContentType: MODEL_3D` (Shopify derives the
  USDZ AR asset automatically).
- `api/shopify/billing/activate.js`, `api/shopify/billing/confirm.js`,
  `api/shopify/billing/status.js`, `api/_lib/shopify/billing.js`: usage-based
  `AppSubscription` ($0.49 per product converted, $100/month cap), running in
  Shopify's `test: true` mode until the app has Public distribution.
- `api/shopify/webhooks/customers-data-request.js`,
  `api/shopify/webhooks/customers-redact.js`,
  `api/shopify/webhooks/shop-redact.js`,
  `api/shopify/webhooks/app-uninstalled.js`,
  `api/_lib/shopify/webhook-verify.js`,
  `api/_lib/shopify/webhook-register.js`: the three mandatory privacy
  webhooks plus `app/uninstalled`, HMAC-verified and delivery-id deduplicated
  against `shopify_webhook_deliveries`.
- `api/_lib/shopify/store.js`,
  `api/_lib/migrations/20261015060000_shopify_app.sql`: persistence for the
  OAuth session, media jobs, billing state, and webhook-delivery ledger
  (`shopify_shops`, `shopify_media_jobs`, `shopify_billing`,
  `shopify_webhook_deliveries`).
- Docs: `docs/shopify-app.md`. Changelog, `data/pages.json`, and
  `STRUCTURE.md` wired.

Scopes requested: `read_products,write_products` only. No customer or order
data is ever read, which is why the two customer-facing privacy webhooks are
correct no-ops rather than real data lookups.

## Step 1: create the Shopify Partner account and app

1. Go to <https://partners.shopify.com> and create a Partner account (free)
   if the owner does not already have one.
2. **Apps → Create app** → **Create app manually**.
3. Name: `Photo to 3D product media`.
4. **App URL**: `https://three.ws/apps/shopify`.
5. **Allowed redirection URL(s)**: `https://three.ws/api/shopify/callback`.
6. Under **Client credentials**, copy the **Client ID** (`SHOPIFY_API_KEY`)
   and **Client secret** (`SHOPIFY_API_SECRET`). The secret is shown once.

## Step 2: configure scopes and embedding

1. Under **App setup → App info**, set the configured **Scopes** to
   `read_products,write_products` (matches `SCOPES` in
   `api/_lib/shopify/config.js`; the install flow requests exactly this
   string, no more).
2. Enable **Embedded app** (the admin UI loads inside the Shopify admin
   iframe via App Bridge).
3. Under **App setup → Webhooks**, leave the UI list empty: this app
   registers all four mandatory webhooks itself via GraphQL
   `webhookSubscriptionCreate` right after OAuth completes, pointed at
   `https://three.ws/api/shopify/webhooks/<topic>`.

## Step 3: set the environment on Cloud Run and in the frontend build

Use `--update-env-vars` (never `--set-env-vars`, which replaces the entire
env set):

```bash
gcloud run services update three-ws-api --region us-central1 \
  --update-env-vars SHOPIFY_API_KEY=<client id>,SHOPIFY_API_SECRET=<client secret>,SHOPIFY_APP_URL=https://three.ws
```

`VITE_SHOPIFY_API_KEY` must also be set to the same client ID as a
**build-time** variable (Vite's HTML env replacement bakes it into
`pages/shopify-app.html`'s `<meta name="shopify-api-key">` tag) before the
next `npm run build` that ships to production.

## Step 4: run the migration

```bash
npm run db:status   # confirm 20261015060000_shopify_app.sql is the pending one expected
npm run db:migrate  # applies immediately, no dry run
```

This creates `shopify_shops`, `shopify_media_jobs`, `shopify_billing`, and
`shopify_webhook_deliveries`.

## Step 5: install on a development store

1. In the Partner Dashboard, **Stores → Add store → Development store**.
2. From the app's **Overview** page, click **Select store** and install on
   the new development store. This exercises the real OAuth flow end to end
   against Shopify's live admin.
3. Add at least one product with a photo before opening the app, so the
   embedded UI has something to generate from.

## Step 6: verify live (this Evolve session cannot reach this point)

1. Open the app from the development store's admin. Confirm the product grid
   loads with real products from the store.
2. Generate a 3D model for one product, preview it with `<model-viewer>`, and
   attach it. Open that product's live storefront page and confirm the 3D
   viewer renders the attached model. Screenshot this as the completion
   evidence for the Definition of Done's first line.
3. Click **Activate billing**, approve the usage plan on Shopify's hosted
   confirmation page (test mode: no real charge), and confirm the banner
   clears. Attach a second model and confirm a usage record appears under
   the app's subscription in the Partner Dashboard's billing section. This is
   the completion evidence for the test-mode-charge Definition of Done line.
4. In the Partner Dashboard, use Shopify's webhook test-delivery tool (
   **App setup → Webhooks → Send test notification**) for each of
   `customers/data_request`, `customers/redact`, `shop/redact`, and
   `app/uninstalled`. Confirm each returns `200` in the delivery log. This is
   the completion evidence for the privacy-webhook Definition of Done line.

## Step 7: App Store submission

Once Step 6 passes, submit through the Partner Dashboard's **Distribution**
tab per the
[App Store requirements checklist](https://shopify.dev/docs/apps/launch/app-requirements-checklist).
Suggested listing copy:

**Name:** Photo to 3D product media

**Tagline:** Turn a product photo into a real 3D model your storefront can
show in AR.

**Description:**

> Give any product a 3D model without a photographer, a 3D artist, or a
> second app to manage payments. Pick a product's photo, generate a real,
> rotatable 3D model, and attach it in one click: Shopify shows it on the
> product page with its own 3D viewer on desktop and AR Quick Look on
> iPhone, automatically, from the single file this app uploads. Bulk-generate
> across an entire catalog with live per-product status, no batch guessing.
> Billing runs through Shopify's own usage-based plan: pay only for the
> products you actually convert, nothing up front.

**Category:** Product media / 3D & AR

**Pricing:** Usage-based, $0.49 per product converted, capped at
$100/month, shown in the merchant's own Shopify bill.

**Primary scopes:** `read_products,write_products` only; no customer or
order data is requested.

## Verification packet

- Source: this repository, `api/shopify/`, `api/_lib/shopify/`,
  `pages/shopify-app.html`, `src/shopify-app/`.
- OAuth HMAC verification and session-token verification are proven with
  real HS256 signing/verification round trips against the app's own secret
  (no mocked crypto); the Admin GraphQL client (`api/_lib/shopify/graphql.js`)
  and Billing mutations are proven against Shopify's documented contract
  shapes, since no live shop or Partner app exists yet to call them against
  for real.
- Local tests: see the `tests/shopify-*.test.js` files added alongside this
  submission.
- `npm run check:rules` passes on every touched file.

## Owner steps (not automatable here)

1. Create the Shopify Partner account and register the app, copy the client
   ID and secret (Step 1).
2. Set scopes to `read_products,write_products` and enable embedding
   (Step 2).
3. Set `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` / `SHOPIFY_APP_URL` on Cloud
   Run with `--update-env-vars`, and `VITE_SHOPIFY_API_KEY` before the next
   frontend build (Step 3).
4. Run `npm run db:migrate` for `20261015060000_shopify_app.sql` (Step 4).
5. Create a development store and install the app (Step 5).
6. Generate and attach a model, verify it on the live storefront, approve a
   test-mode billing charge, and send test webhook deliveries from the
   Partner Dashboard; capture the screenshots this Definition of Done needs
   (Step 6).
7. Submit the App Store listing using the copy above (Step 7).
