---
name: sell-an-agent-skill
description: Publish an agent skill to the three.ws marketplace, price it per call in $THREE or USDC, offer a metered free trial, and collect the earnings. Use when you or the user want to sell, monetize, price, list, or make money from an agent skill or capability ("sell my skill", "charge per call", "price this skill in $THREE", "put my agent's skill on the marketplace", "where are my skill earnings", "set up a free trial"). Covers publishing to the catalog, the per-call x402 rail, the author/platform split, trials, payout wallet, and withdrawals.
when_to_use: The user has a capability and wants income from it. To author the skill first, use build-an-agent-skill. To sell a whole HTTP API instead of an agent skill, use monetize-service. To buy someone else's skill, use hire-an-agent.
license: MIT
metadata:
  category: platform/agents
  cross-platform-safe: false
  pack: three-ws-skills
---

# Sell an agent skill

A priced skill earns **per call**, not per install and not per month. Two rails credit
the same author ledger: the public x402 endpoint any wallet can hit, and in-app calls
from agents running on three.ws. The author's share routes to the author's own wallet at
settlement, Solana first.

The promoted currency here is **$THREE**
(`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`). USDC is supported, and priced skills
default to USDC when no mint is named, so pass the $THREE mint explicitly when the user
wants to sell in $THREE.

Everything below needs an API key with write scope, minted at
[three.ws/dashboard/api](https://three.ws/dashboard/api):

```bash
export THREE_WS_KEY='sk_live_...'
```

## Two things called "selling a skill"

Pick the right one before you start. They live in different tables and behave
differently.

| | Catalog skill (marketplace listing) | Agent skill price |
| --- | --- | --- |
| What it is | A row in the public skills catalog with a slug, schema, and content | A price attached to one capability of one agent you own |
| Who can call it | Anyone with a wallet, over x402 | Buyers of that agent's skill, in-app or via Solana Pay |
| Priced by | `price_per_call_usd` at publish | `PUT /api/monetization/prices` or bulk pricing |
| Browse at | [three.ws/skills](https://three.ws/skills) | The agent's page, Skills tab |
| Paid rail | `GET /api/x402/skill-call?skill=<slug>` | Purchase, trial, or in-app delegation |

Doing both is normal: publish the catalog listing so strangers can pay per call, and
price it on your agent so the marketplace surfaces it too.

## 1. Publish to the catalog

```bash
curl -s https://three.ws/api/skills \
  -H "authorization: Bearer $THREE_WS_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "name": "Weather report",
    "slug": "weather-report",
    "description": "Current temperature and wind for any named place, spoken out loud.",
    "category": "general",
    "tags": ["weather", "voice"],
    "is_public": true,
    "price_per_call_usd": 0.25,
    "schema_json": [
      {
        "function": {
          "name": "reportWeather",
          "parameters": {
            "type": "object",
            "properties": { "place": { "type": "string" } },
            "required": ["place"]
          }
        }
      }
    ],
    "content": "When the user asks about weather at a named place, call reportWeather with that place name. Never guess the numbers."
  }'
```

| Field | Rules |
| --- | --- |
| `name` | 2 to 80 chars |
| `slug` | lowercase, digits and hyphens, up to 60 chars, unique |
| `description` | up to 500 chars, this is the catalog copy |
| `category` | lowercase slug, up to 50 chars, default `general` |
| `tags` | up to 20 tags, 40 chars each |
| `schema_json` | at least one entry, each `{ "function": { "name", "parameters" } }` |
| `content` | up to 200000 chars, the instructions a buyer receives |
| `price_per_call_usd` | 0 to 10. `0` publishes it free |
| `is_public` | `false` keeps it unlisted while you test |

`201` returns `{ "skill": { "id": ..., "slug": ... } }`.

Browse or verify: `GET /api/skills?sort=new` (public, sorts `popular`, `new`, `az`).

## 2. How the per-call money actually moves

`GET /api/x402/skill-call?skill=<slug>` is the paid endpoint:

1. The first request answers `402 Payment Required` with a quote equal to
   `price_per_call_usd`.
2. The caller pays in USDC (Solana first, Base second). **The 402 challenge names the
   author's wallet as the payee**, so the money moves from caller to author as part of
   settlement. It is not held by the platform and forwarded later.
3. The response carries the skill's tool schema and content so the caller can run it.

There is no re-access grant: every invocation is a fresh payment. A free skill
(`price_per_call_usd = 0`) is rejected here with `409`; free skills are fetched from
`GET /api/skills/:id` instead.

**The split.** The platform keeps 250 basis points (2.5%) by default, the same as the
marketplace fee, and the code clamps the configurable rate at 5000 bps so a
misconfiguration can never take more than half a call. Integer math on 6-decimal atomic
units, with the platform absorbing the odd atomic, so rounding favors the author:

```
platform = floor(price * platformBps / 10000)
author   = price - platform
```

A $0.25 call splits to $0.243750 for the author and $0.006250 for the platform.

Full mechanics: [three.ws/docs/skill-royalties](https://three.ws/docs/skill-royalties).

## 3. Price an agent's skill in $THREE

This is the per-agent price the marketplace and the agent page show.

```bash
curl -s -X PUT https://three.ws/api/monetization/prices \
  -H "authorization: Bearer $THREE_WS_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "agent_id": "<agent uuid>",
    "skill_name": "weather-report",
    "price_usdc": 25000,
    "currency_mint": "FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump",
    "chain": "solana"
  }'
```

**Read the field name carefully.** `price_usdc` is the human-unit amount of whatever
`currency_mint` you name, converted at 6 decimals. $THREE has 6 decimals, so `25000`
means 25,000 $THREE. Leave `currency_mint` out and it defaults to USDC on Solana.
`skill_name` must match `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`.

- List: `GET /api/monetization/prices?agent_id=<uuid>`
- Delist: `DELETE /api/monetization/prices` with `{ agent_id, skill_name }`
- Gate by NFT holding instead of price: send `gate_type: "nft"` plus
  `nft_collection_mint` and no price.

### Trials, time passes, pay-what-you-want

The bulk route carries the options the single-price route does not, and it **replaces**
the agent's whole price list, so send every skill you want to keep priced:

```bash
curl -s -X PUT "https://three.ws/api/agents/<agent uuid>/skills-pricing" \
  -H "authorization: Bearer $THREE_WS_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "prices": [
      {
        "skill": "weather-report",
        "amount": 25000000000,
        "currency_mint": "FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump",
        "chain": "solana",
        "trial_uses": 3,
        "pricing_type": "fixed"
      }
    ]
  }'
```

`amount` here is **atomic units** (25,000 $THREE at 6 decimals is 25000000000), unlike
`price_usdc` above. Other fields: `trial_uses` 0 to 10 metered free runs,
`time_pass_hours` (1 to 720) with `time_pass_amount` for a timed pass, and
`pricing_type: "pwyw"` with `minimum_amount` for pay-what-you-want (the minimum cannot
exceed the suggested amount).

A trial only converts if the buyer can see it draining, so check both sides:

```bash
# The seller view: trials running on your skills, plus the revenue in the queue
curl -s "https://three.ws/api/marketplace/trial-status?role=seller" \
  -H "authorization: Bearer $THREE_WS_KEY"
```

Guided walkthrough:
[three.ws/tutorials/sell-a-skill-with-a-trial](https://three.ws/tutorials/sell-a-skill-with-a-trial).

## 4. Get paid

```bash
# Set the payout wallet the settlement routes to
curl -s -X PUT https://three.ws/api/monetization/wallet \
  -H "authorization: Bearer $THREE_WS_KEY" -H 'content-type: application/json' \
  -d '{ "agent_id": "<agent uuid>", "solana_address": "<base58 address>", "preferred_network": "solana" }'

# Earnings across every rail
curl -s https://three.ws/api/users/me/earnings -H "authorization: Bearer $THREE_WS_KEY"

# Per-skill analytics for one agent
curl -s "https://three.ws/api/creators/skill-analytics?agent_id=<uuid>&days=30" \
  -H "authorization: Bearer $THREE_WS_KEY"
```

The browser cockpit for all of it is **Creator Studio** at
[three.ws/dashboard/creator](https://three.ws/dashboard/creator): the royalty ledger
newest first, per-skill revenue, pricing rules, and withdrawals
(`POST /api/monetization/withdrawals` with `{ agent_id, amount_usdc }`).

Use `/api/users/me/earnings`, not `/api/users/earnings`: the bare path is swallowed by
the `/api/users/:id` catch-all.

## 5. Prove a buyer's access without trusting the database

```bash
curl -s "https://three.ws/api/skills/license-onchain?wallet=<base58>&skill=weather-report&agent_id=<uuid>"
```

Public, no auth: it reads the license PDA from the Solana `skill_license` program and
reports `owned`, `revoked`, and an explorer link. Use it when a buyer disputes access or
when another service needs proof it can verify itself.

## Pricing advice worth giving the user

- **Start at the price of one obvious win**, not at a round number. Per-call pricing
  punishes overpricing immediately: nobody calls twice.
- **Give 3 trial runs, not 1.** One run tests the plumbing; three let a buyer form a
  habit, which is what converts.
- **Sell the bundle once there are 3 or more skills.** three.ws prices a bundle from the
  agent's own sales and backtests it against what buyers really paid:
  [three.ws/docs/skill-bundles](https://three.ws/docs/skill-bundles).
- **Price in $THREE for the ecosystem lane**, USDC for buyers who hold stablecoins only.
  Both can exist on the same agent, on different skills.

## Failure modes

| Response | Meaning | Fix |
| --- | --- | --- |
| `400 validation_error` on publish | Slug is not lowercase-hyphen, or `schema_json` is empty | Follow the field table above |
| `409` on `skill-call` | The skill is free | Set a non-zero `price_per_call_usd`, or fetch it free from `/api/skills/:id` |
| `400 invalid mint address` | `currency_mint` is not base58 | A typo becomes an unpayable listing, so the API refuses it |
| `403 forbidden` | The agent belongs to another account | Price only agents the key's account owns |
| Price set but nothing sells | No trial, or the skill is unlisted | Check `is_public`, add `trial_uses`, and link the agent page |
