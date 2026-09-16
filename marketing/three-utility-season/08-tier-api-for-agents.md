# Edition 08: What $THREE does this week, pay for agent tools over x402

| Field | Value |
|---|---|
| Campaign id | `MKT-2026-11-THREE-X402` |
| Publish date | 2026-11-06 |
| Chapter | Agent work |
| Audience | agent and API builders |
| Campaign anchor (campaigns.csv) | https://three.ws/x402 |
| Surface used in this pack | `GET /api/three/tier` |
| Verified status (2026-09-16) | **Advertised but not settleable. Substitute used.** |

## Verification

**Substitute:** Paying x402 endpoints in $THREE cannot settle today. The substitute is the public tier endpoint any agent can call to read a wallet's $THREE standing before it serves or discounts a request.

- Planned surface: a 402 challenge from `https://three.ws/api/x402/token-intel` lists a second `accepts` entry with the $THREE mint on Solana (`X402_ACCEPT_THREE_SOLANA` defaults to true in `api/_lib/env.js`).
- Blocker: the configured facilitator is self-hosted (`X402_FACILITATOR_URL_SOLANA=https://three.ws/api/x402-facilitator`). `api/_lib/x402/self-facilitator.js` only accepts transfers under the legacy token program and rejects any other program with `program_not_allowed`. $THREE is a Token-2022 mint, so a $THREE payment cannot pass verification.
- The `/x402` page itself says settlement is "in USDC".
- Substitute: `GET https://three.ws/api/three/tier` answered 200 without auth on 2026-09-16 with `tier`, `next.usd_to_go`, and the ladder; `?wallet=<address>` returned a resolved tier for a mainnet holder.
- Docs gap: this public endpoint is not documented in `docs/api-reference.md`.

## The three questions

- **What can a holder do now?** Call `curl "https://three.ws/api/three/tier?wallet=<address>"` from an agent and branch on `tier.level`.
- **Where does $THREE enter?** Held. The endpoint values the $THREE the wallet holds and returns its level, `discount_bps`, and `rate_multiplier`.
- **What verifiable result comes out?** A JSON tier verdict an agent can act on, with no API key and no signature.

## Numbers and their sources

| Stable fact | Source and capture date |
|---|---|
| Unauthenticated, `?wallet=` supported, fields `tier`, `next`, `ladder` | live response, 2026-09-16 |

## Media

- File: [`images/08-tier-api.png`](./images/08-tier-api.png), 1600x900, captured 2026-09-16 from `/api/three/tier` by `node marketing/three-utility-season/capture.mjs --only 08`.
- Alt text (required on every post):

> Raw JSON from three.ws/api/three/tier: signed_in false, tier Member, next tier Bronze with usd_to_go 25, and the ladder of Member, Bronze, Silver, Gold, and Genesis with discount_bps and rate_multiplier for each.

## X post

Weighted length: **161 characters** (URL counted as 23, as `scripts/post-tweet.mjs` does).

```text
An agent can read any Solana wallet's $THREE tier with one unauthenticated GET: level, perks, and the USD still to go. No key, no signup. https://three.ws/api/three/tier?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-11-three-x402&utm_content=utility-post
```

## Telegram

```text
What $THREE does this week: a tier check any agent can call.
GET three.ws/api/three/tier?wallet=<address> returns that wallet's $THREE tier, its perks, and how far it is from the next tier. No key, no signup.
Builders can use it to decide what a holder gets from their own agent or API.
Paying x402 endpoints in $THREE is not working yet; payments settle in USDC today.
https://three.ws/api/three/tier?utm_source=telegram&utm_medium=community&utm_campaign=mkt-2026-11-three-x402&utm_content=utility-telegram
```

## User action

Call `curl "https://three.ws/api/three/tier?wallet=<address>"` from an agent and branch on `tier.level`.

## KPI and where to read it

External tier reads. Count `/api/three/tier` requests carrying `wallet=` and a non-browser user agent in `three-ws-api` request logs for the week; UTM sessions for `mkt-2026-11-three-x402`.

Record the 24-hour and seven-day rows in the format in [measurement.md](../growth/measurement.md).

## Posting-day checklist

- [ ] Re-open the linked surface in a clean browser and confirm it loads without errors.
- [ ] `curl` the endpoint with and without `?wallet=` and confirm 200.
- [ ] Re-test a $THREE x402 payment. If the facilitator settles one, the owner can restore the x402 story.
- [ ] Re-run `capture.mjs --only 08`.
- [ ] Attach the image and paste the alt text.
- [ ] Owner presses publish. Nothing in this pack posts automatically.

## Do not

- Do not say agents can pay in $THREE over x402.
- The `perks` strings in the JSON include Planned perks; do not quote them as available.
- No price, return, urgency, or "moon" language. No hashtags, no emoji.
