# Shopify app: Photo to 3D product media

three.ws ships a [Shopify embedded app](https://shopify.dev/docs/apps/build/embedded-app-components)
that turns a product photo into a real, rotatable 3D model and attaches it to
the product. Shopify then shows it on the storefront with its own 3D viewer on
desktop and iOS AR Quick Look on iPhone, both derived from the single GLB this
app uploads.

**On this page:** [How it works](#how-it-works) · [Auth flow](#auth-flow) · [Billing](#billing) · [Privacy webhooks](#privacy-webhooks) · [Owner setup](#owner-setup)

---

## How it works

1. A merchant installs the app from the Shopify App Store (or a direct install
   link during development) and lands on the embedded admin page
   (`pages/shopify-app.html`, `src/shopify-app/app.js`), which lists the
   store's products.
2. For a product without a 3D model, the merchant clicks **Generate 3D
   model**. The app submits the product's first image to three.ws's own
   `/api/forge` image-to-3D pipeline (`api/_mcp-studio/forge-client.js`, the
   same pipeline every other three.ws 3D surface runs on, no separate
   generation logic).
3. Once generation finishes, the GLB is staged into Shopify's own upload
   storage (`stagedUploadsCreate`) and the merchant previews it in-page with
   `<model-viewer>` before confirming **Attach to product**.
4. Attaching calls `productCreateMedia` with `mediaContentType: MODEL_3D`.
   Shopify auto-derives the USDZ AR Quick Look asset from the uploaded GLB, so
   this app uploads exactly one file per product, not two.
5. **Bulk mode**: select every product missing a 3D model and click
   **Generate selected**; each card tracks its own real status
   (generating → ready → attaching → attached, or failed with a retry
   button) instead of one opaque batch spinner.

## Auth flow

Two different authentication shapes, both documented by Shopify:

- **OAuth (install)**: `GET /api/shopify/install` → Shopify's own
  `/admin/oauth/authorize` → `GET /api/shopify/callback`, which verifies the
  query-string HMAC (`api/_lib/shopify/hmac.js`), checks the `state` nonce
  cookie, exchanges the code for an **offline** access token, and registers
  the four mandatory webhooks.
- **Embedded API calls**: every `/api/shopify/*` route other than
  `install`/`callback`/`webhooks`/`billing/confirm` requires a session token
  (`Authorization: Bearer <token>`), the short-lived HS256 JWT Shopify's App
  Bridge CDN script attaches via `window.shopify.idToken()`. Verified in
  `api/_lib/shopify/session-token.js` against the app's client secret, then
  matched to the shop's stored offline token (`api/_lib/shopify/auth-request.js`)
  so the actual Admin GraphQL calls always run with the install-time token,
  never the session token itself.

App Bridge loads via Shopify's CDN script
(`https://cdn.shopify.com/shopifycloud/app-bridge.js`), not the
`@shopify/app-bridge` npm package or the Remix app template: this repo is
vanilla JS + Vite, and the CDN script is Shopify's current framework-agnostic
path. The app's public API key reaches the page through Vite's HTML env
replacement (`%VITE_SHOPIFY_API_KEY%` in `pages/shopify-app.html`), baked in
at build time from the same client id as the server's `SHOPIFY_API_KEY`.

## Billing

One usage-based `AppSubscription` per shop (`api/_lib/shopify/billing.js`):
$0.49 per product converted, capped at $100/month, priced from Forge's own
per-call cost plus Shopify's revenue share. The merchant approves it once
(`POST /api/shopify/billing/activate` → Shopify's own confirmation page,
opened with `window.open(url, '_top')` since Billing approval cannot happen
inside the embedded iframe); `GET /api/shopify/billing/confirm` re-checks
Shopify's own `currentAppInstallation.activeSubscriptions` and records the
result. A usage record is only created at the moment a model is actually
attached (`POST /api/shopify/media/attach`), never for a generation the
merchant discarded.

Every subscription this app creates runs with `test: true` until the app is
approved for Public distribution on the App Store (Shopify's own
`AppSubscriptionCreate` restriction); Shopify records the usage but never
settles a test charge, so the full flow is exercisable before launch. Flip
with `SHOPIFY_BILLING_LIVE=1` once the app is live.

## Privacy webhooks

Four webhooks, registered via GraphQL `webhookSubscriptionCreate` right after
OAuth completes (`api/_lib/shopify/webhook-register.js`), each verified
against `X-Shopify-Hmac-Sha256` (`api/_lib/shopify/webhook-verify.js`) and
claimed against a delivery-id ledger (`shopify_webhook_deliveries`) before any
handler logic runs, so a Shopify retry never double-processes. If a handler's
side effect throws, the claim is released (`applyClaimed` in `webhook-verify.js`)
before the 5xx goes back, so Shopify's retry runs the effect again instead of
hitting the ledger and skipping an erasure or uninstall:

- `customers/data_request`, `customers/redact`: no-ops. This app never reads
  customer data (scopes are `read_products,write_products` only) and stores
  nothing keyed by a customer id, so there is nothing to return or erase.
- `shop/redact`: genuinely erases every row this app stored for the shop
  (media jobs, billing, the OAuth session) 48 hours after uninstall.
- `app/uninstalled`: marks the shop's session dead immediately so no later
  call tries to use an access token Shopify has already revoked.

## Owner setup

The app needs a Shopify Partner account, a registered app, and a development
store before any of this can run live. Exact Partner Dashboard settings, env
vars, and the App Store listing copy are written out in
[`marketing/growth/submissions/shopify-app.md`](https://github.com/nirholas/three.ws/blob/main/marketing/growth/submissions/shopify-app.md).
Owner action is tracked in `prompts/finish/_context/production-100-OWNER-ACTIONS.md`.
