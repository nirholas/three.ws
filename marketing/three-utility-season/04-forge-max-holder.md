# Edition 04: What $THREE does this week, agent labor and escrow

| Field | Value |
|---|---|
| Campaign id | `MKT-2026-10-THREE-LABOR` |
| Publish date | 2026-10-09 |
| Chapter | Agent work |
| Audience | agent builders and community |
| Campaign anchor (campaigns.csv) | https://three.ws/labor-market |
| Surface used in this pack | /forge-max |
| Verified status (2026-09-16) | **Enabled but off. Substitute used.** |

## Verification

**Substitute:** The labor market escrow is not configured in production. The substitute is the live Forge Max holder perk: an agent builder can give an agent a maximum-quality body by holding Bronze.

- Planned surface: `/labor-market` (route to `pages/labor-market.html`) loads, but `GET https://three.ws/api/labor/feed` returned `escrow_configured: false`, `settled_jobs: 0`, `open_bounties: 0` on 2026-09-16; the page shows "ESCROW Offline". `LABOR_ESCROW_SECRET_BASE58` is absent on `three-ws-api`, so `api/_lib/labor-escrow.js` refuses to hold funds (typed 503).
- Substitute: `/forge-max` (in `data/pages.json`) loads; `api/forge.js` calls `requireFeatureAccess(req, res, 'forge.high')`, and `/api/three/access` lists `forge.high` with `enforced: true`, minimum Bronze.

## The three questions

- **What can a holder do now?** Sign in with a wallet holding Bronze, open `/forge-max`, and run one High generation.
- **Where does $THREE enter?** Held. Bronze ($25 of $THREE held) is checked through a signed tier pass before a High generation runs. The pay-per-generation alternative shown on the page settles through the $THREE token rail, which is currently unavailable (see edition 03), so the copy only describes holding.
- **What verifiable result comes out?** A High-tier generation: up to 200,000-polygon geometry with PBR textures, downloadable as GLB.

## Numbers and their sources

| Stable fact | Source and capture date |
|---|---|
| "up to 200,000 polygons", "Requires Bronze" | captured frame of `/forge-max`, 2026-09-16 |

## Media

- File: [`images/04-forge-max-holder.png`](./images/04-forge-max-holder.png), 1600x900, captured 2026-09-16 from `/forge-max` by `node marketing/three-utility-season/capture.mjs --only 04`.
- Alt text (required on every post):

> The three.ws Forge Max page with High quality selected and a lock card reading "Requires Bronze, hold $THREE", with Get $THREE and Sign in buttons; the details line says High renders up to 200,000 polygons.

## X post

Weighted length: **171 characters** (URL counted as 23, as `scripts/post-tweet.mjs` does).

```text
Forge Max builds up to 200,000-polygon models with PBR textures. Holding $25 of $THREE (Bronze) opens it, verified from your wallet, nothing spent. https://three.ws/forge-max?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-10-three-labor&utm_content=utility-post
```

## Telegram

```text
What $THREE does this week: a better body for your agent.
Forge Max on three.ws builds up to 200,000-polygon models with PBR textures. Holding $25 of $THREE (Bronze) opens it. The balance is checked, not spent.
Standard generation stays free for everyone.
The agent labor market with $THREE escrow is built but its escrow is offline in production, so it is not this week's walkthrough.
https://three.ws/forge-max?utm_source=telegram&utm_medium=community&utm_campaign=mkt-2026-10-three-labor&utm_content=utility-telegram
```

## User action

Sign in with a wallet holding Bronze, open `/forge-max`, and run one High generation.

## KPI and where to read it

High generations by holders. UTM sessions for `mkt-2026-10-three-labor`; `forge_creations` rows with the High tier during the week.

Record the 24-hour and seven-day rows in the format in [measurement.md](../growth/measurement.md).

## Posting-day checklist

- [ ] Re-open the linked surface in a clean browser and confirm it loads without errors.
- [ ] Run one High generation from a Bronze wallet and confirm the lock card clears.
- [ ] Re-check `/api/labor/feed`. If `escrow_configured` is true and a bounty settles, the owner can restore the labor story.
- [ ] Re-run `capture.mjs --only 04`.
- [ ] Attach the image and paste the alt text.
- [ ] Owner presses publish. Nothing in this pack posts automatically.

## Do not

- Do not mention escrow, bounties, or agent wages.
- Do not promote the "Pay $0.50 per generation" button until a $THREE quote succeeds.
- No price, return, urgency, or "moon" language. No hashtags, no emoji.
