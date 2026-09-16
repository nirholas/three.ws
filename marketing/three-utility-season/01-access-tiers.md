# Edition 01: What $THREE does this week, hold-to-access tiers

| Field | Value |
|---|---|
| Campaign id | `MKT-2026-09-THREE-ACCESS` |
| Publish date | 2026-09-18 |
| Chapter | Access |
| Audience | community and holders |
| Campaign anchor (campaigns.csv) | https://three.ws/three-token |
| Surface used in this pack | /three |
| Verified status (2026-09-16) | **Live** |

## Verification

**Substitute:** None. The copy links `/three` (the tier page) instead of the campaign anchor `/three-token` (the token overview), because the tier check happens on `/three`.

- Route: `vercel.json` maps `/three/?` to `pages/three.html`; the page is driven by `src/three-tier-page.js`.
- API: `GET https://three.ws/api/three/tier` (handler `api/three/[action].js`, ladder in `api/_lib/three-tier.js`) answered 200 on 2026-09-16 with the five-level ladder. Passing `?wallet=<address>` returned a resolved tier for a real holder wallet.
- Perk registry: `GET https://three.ws/api/three/access` (from `api/_lib/three-access.js`) reports `forge.high` and `forge.gameready` with `enforced: true`; the other five perks are `enforced: false` and the page labels them PLANNED.

## The three questions

- **What can a holder do now?** Open `/three`, connect a Solana wallet, read the tier shown, then open one LIVE perk (Forge Max at `/forge-max`).
- **Where does $THREE enter?** Nowhere is $THREE spent. The platform reads the USD value of $THREE held in the connected wallet and maps it to a tier (Member $0, Bronze $25, Silver $100, Gold $500, Genesis $2,500).
- **What verifiable result comes out?** The page shows the wallet's tier, the USD still needed for the next one, and which perks are LIVE versus PLANNED. The same resolution is readable as JSON at `/api/three/tier?wallet=`.

## Numbers and their sources

| Stable fact | Source and capture date |
|---|---|
| Tier thresholds: $25 / $100 / $500 / $2,500 held | `/api/three/tier` ladder, captured 2026-09-16 |
| Bronze perks marked LIVE: High-quality generation, Game-Ready export | `/api/three/access`, captured 2026-09-16 |
| 2 of 7 registered perks enforced | `/api/three/access` (`enforced: true` count), captured 2026-09-16 |

## Media

- File: [`images/01-access-tiers.png`](./images/01-access-tiers.png), 1600x900, captured 2026-09-16 from `/three` by `node marketing/three-utility-season/capture.mjs --only 01`.
- Alt text (required on every post):

> The three.ws $THREE Tiers page: a Connect wallet button above the tier ladder. Bronze requires $25 held and lists 5% off compute, 2x free quota, and two perks marked LIVE: high-quality generation and Game-Ready export. Silver's private worlds are marked PLANNED.

## X post

Weighted length: **174 characters** (URL counted as 23, as `scripts/post-tweet.mjs` does).

```text
Your $THREE tier on three.ws is read live from your wallet. Bronze starts at $25 held and opens High-quality Forge and Game-Ready export. Check yours: https://three.ws/three?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-09-three-access&utm_content=utility-post
```

## Telegram

```text
What $THREE does this week: hold-to-access tiers.
Open three.ws/three and connect a Solana wallet. The page reads the $THREE you hold (nothing is spent) and shows your tier.
Live at Bronze ($25 held): High-quality Forge generation and Game-Ready export.
Silver and above list perks marked Planned. Those are not switched on yet, and the page says so.
https://three.ws/three?utm_source=telegram&utm_medium=community&utm_campaign=mkt-2026-09-three-access&utm_content=utility-telegram
```

## User action

Open `/three`, connect a Solana wallet, read the tier shown, then open one LIVE perk (Forge Max at `/forge-max`).

## KPI and where to read it

Tier checks and benefit uses. Read UTM sessions for `utm_campaign=mkt-2026-09-three-access` in web analytics; read tier resolutions from Cloud Run request logs for `/api/three/tier` and `/api/three/tier-pass` (`gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="three-ws-api" httpRequest.requestUrl:"/api/three/tier"' --freshness=7d`).

Record the 24-hour and seven-day rows in the format in [measurement.md](../growth/measurement.md).

## Posting-day checklist

- [ ] Re-open the linked surface in a clean browser and confirm it loads without errors.
- [ ] `curl -s https://three.ws/api/three/access` still shows `forge.high` and `forge.gameready` with `enforced: true`.
- [ ] The ladder thresholds in `/api/three/tier` still match the post ($25 Bronze).
- [ ] Re-run `node marketing/three-utility-season/capture.mjs --only 01` and confirm the frame shows LIVE and PLANNED badges.
- [ ] Attach the image and paste the alt text.
- [ ] Owner presses publish. Nothing in this pack posts automatically.

## Do not

- Do not list Silver, Gold, or Genesis perks as available. Five of seven are Planned.
- Do not mention the token price or what $25 of $THREE is worth in tokens.
- No price, return, urgency, or "moon" language. No hashtags, no emoji.
