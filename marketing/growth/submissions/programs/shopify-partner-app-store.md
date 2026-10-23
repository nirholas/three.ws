# Shopify Partner account and App Store review

Program: Shopify Partner account, then App Store review of "Photo to 3D product media".
Full build record, app configuration, env vars, billing, webhooks, listing copy and verification packet: [../shopify-app.md](../shopify-app.md) (order 091). This file adds the review layer and the verified listing limits.
Page last read: 2026-10-23 (<https://shopify.dev/docs/apps/launch/app-requirements-checklist>). The page covers billing, listing fields and screencast rules; it does not state the submission steps or the review turnaround, so those are **not verified on 2026-10-23**.
Tracker: no dedicated row in `opportunities.csv`; prospect score 14 in `docs/partners/prospects.md`.
Nothing has been submitted. Shared facts and owner-only inputs: [README.md](./README.md).

## Deadline and eligibility

No deadline. Partner account is free. Blocker to date: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL` and `VITE_SHOPIFY_API_KEY` are unset in production, so the app has not been installed on any store.

## Listing fields against Shopify's limits (read 2026-10-23)

| Field | Limit | Draft |
|---|---|---|
| App name | 30 characters, brand-led, identical to the TOML config | `Photo to 3D product media` is 25 characters. Brand-led is preferable: `three.ws 3D Product Media` (25) is the recommendation; keep whichever the TOML uses |
| App icon | 1200 x 1200 px JPEG or PNG, no text, screenshots or Shopify marks | Owner builds from `public/logo.png` art without lettering |
| Feature media | 2 to 3 minute video preferred, or a 1600 x 900 image with alt text | Screencast recorded in Step 6 of the linked file |
| Screenshots | 3 to 6 at 1600 x 900, one showing the app UI, with alt text; no PII, pricing, reviews or outcome guarantees | Product picker, generation preview in `<model-viewer>`, bulk status, product page with the 3D media |
| App introduction | 100 characters | Turn a product photo into a real 3D model your storefront can show in AR. (72 characters) |
| App details | 500 characters | Use the linked file's description; trim to 500 and drop the pricing sentence per the screenshot rule if the reviewer objects |
| Feature list | 80 characters each | Photo to rotatable 3D model in one click / Bulk-convert a whole catalog with live status / Works with Shopify's built-in 3D viewer and AR / Pay only per product converted |
| Integrations | up to 6 | None required |
| Search terms | up to 5, one idea each | 3D product, AR, product media, 3D model, GLB |
| Demo store URL | development store showing the app | Owner input after Step 5 |
| Privacy policy | required | `https://three.ws/legal/privacy` |
| Install eligibility | required sales channels, geography | Online Store channel; no geographic limit known |
| Billing | Must use Shopify billing, upgrades and downgrades without contacting support, charges visible in app charge history | Usage-based `AppSubscription`, USD 0.49 per product converted, USD 100 per month cap, in `test: true` mode until Public distribution |
| Free trial | page recommends 14 days | Optional; the current build has none |
| Screencast | complete setup and functionality, English or English subtitles, expected outcome per test case; test credentials for third-party platforms | Owner records on a development store |

Scopes requested: `read_products,write_products`. No customer or order data is read, so the two customer privacy webhooks are intentional no-ops (HMAC-verified and recorded).

## Owner steps

1. Create the Partner account and app (Steps 1 and 2 of the linked file); set env vars, migration, install on a development store.
2. Verify live and record the screencast (Step 6).
3. Distribution tab in the Partner Dashboard: choose Public distribution, paste the table above, submit.
4. Switch billing out of test mode only after the app has Public distribution, as built.
5. Log the outcome in `opportunities.csv` and add the App Store URL to `docs/shopify-app.md`.
