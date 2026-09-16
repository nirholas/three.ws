# Edition 02: What $THREE does this week, lower-cost platform access

| Field | Value |
|---|---|
| Campaign id | `MKT-2026-09-THREE-DISCOUNT` |
| Publish date | 2026-09-25 |
| Chapter | Access |
| Audience | community and creators |
| Campaign anchor (campaigns.csv) | https://three.ws/pricing |
| Surface used in this pack | /forge |
| Verified status (2026-09-16) | **Not live (planned surface is wired but switched off). Substitute used.** |

## Verification

**Substitute:** The planned story, paying for Pro at 20% off in $THREE on `/pricing`, cannot be completed in production today. The substitute is the live holder free-quota multiplier on the free Forge lane, which lowers the cost of access without a payment.

- Planned surface: `/pricing` renders "Pay in USDC, SOL, or $THREE, 20% off in $THREE", and `GET https://three.ws/api/payments/solana/plans` returns `three_discount_bps: 2000` and Pro at $39.20 in $THREE.
- Blocker: a signed-in `POST /api/payments/solana/checkout` with `{"plan":"pro","asset":"THREE"}` returned `503 not_configured: Solana payment recipient not configured` on 2026-09-16 (also for USDC). `PAYMENT_RECIPIENT_SOLANA` is not set on the `three-ws-api` Cloud Run service (`api/payments/_config.js`).
- Substitute: `api/forge.js` `freeLaneMultiplier()` lifts the free-lane hourly limit by the tier multiplier from a verified tier pass (`api/_lib/rate-limit.js` `mcp3dGenerateFreeTiered`). The ladder in `/api/three/tier` lists `rate_multiplier` 2, 3, 5, 10. The `/forge` page shows "Hold $THREE for up to 10x free generations".

## The three questions

- **What can a holder do now?** Open `/forge`, connect a wallet holding at least Bronze, and generate past the default hourly free limit.
- **Where does $THREE enter?** Held, not spent. A signed tier pass derived from the wallet's $THREE balance travels with each free generation request and raises that wallet's hourly free limit.
- **What verifiable result comes out?** More free generations per hour for the same wallet: 2x at Bronze, 3x Silver, 5x Gold, 10x Genesis.

## Numbers and their sources

| Stable fact | Source and capture date |
|---|---|
| Multipliers 2x / 3x / 5x / 10x | `/api/three/tier` `rate_multiplier`, captured 2026-09-16 |
| "Hold $THREE for up to 10x free generations" on `/forge` | captured frame, 2026-09-16 |

| Volatile figure (read on posting day) | Source |
|---|---|
| The base hourly free limit is deployment config (`FORGE_FREE_HOURLY_SELFHOST`); do not quote an absolute number | n/a |

## Media

- File: [`images/02-holder-free-quota.png`](./images/02-holder-free-quota.png), 1600x900, captured 2026-09-16 from `/forge` by `node marketing/three-utility-season/capture.mjs --only 02`.
- Alt text (required on every post):

> The three.ws Forge page: a prompt box, quality options Draft, Standard, and High with a $THREE badge, a Generate button, and a line under it reading "Hold $THREE for up to 10x free generations" next to a Connect wallet button.

## X post

Weighted length: **170 characters** (URL counted as 23, as `scripts/post-tweet.mjs` does).

```text
Holding $THREE lifts your free Forge generation limit: 2x at Bronze, up to 10x at Genesis. Nothing is spent; the balance is read from your wallet. https://three.ws/forge?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-09-three-discount&utm_content=utility-post
```

## Telegram

```text
What $THREE does this week: more free generations.
Forge on three.ws is free to use. Holding $THREE raises how many free generations your wallet gets per hour: 2x at Bronze ($25 held), up to 10x at Genesis.
Nothing is spent. Connect a wallet on three.ws/forge and generate.
Paying for Pro in $THREE is shown on /pricing but checkout is not switched on yet, so this week is about holding.
https://three.ws/forge?utm_source=telegram&utm_medium=community&utm_campaign=mkt-2026-09-three-discount&utm_content=utility-telegram
```

## User action

Open `/forge`, connect a wallet holding at least Bronze, and generate past the default hourly free limit.

## KPI and where to read it

THREE-tier free generations. Read UTM sessions for `mkt-2026-09-three-discount`; read generations by tier from `forge_creations` (backend and status per generation) joined with tier-pass usage in `/api/forge` logs. Checkout completions stay at zero until the recipient is configured.

Record the 24-hour and seven-day rows in the format in [measurement.md](../growth/measurement.md).

## Posting-day checklist

- [ ] Re-open the linked surface in a clean browser and confirm it loads without errors.
- [ ] Re-test the planned story: signed-in `POST /api/payments/solana/checkout` with asset THREE. If it now returns an intent, the owner may switch this edition back to the `/pricing` story (the frame and copy would need re-capture and rewriting).
- [ ] Confirm `/forge` still shows the "up to 10x free generations" line.
- [ ] Re-run `capture.mjs --only 02`.
- [ ] Attach the image and paste the alt text.
- [ ] Owner presses publish. Nothing in this pack posts automatically.

## Do not

- Do not say "pay in $THREE for 20% off" until a real checkout completes.
- Do not quote an hourly generation number.
- No price, return, urgency, or "moon" language. No hashtags, no emoji.
