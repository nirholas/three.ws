# Developer plans

Every API key, OAuth token and signed-in session on three.ws sits on a developer plan. A plan says how many calls an account may make to the versioned API (`/api/v1/…`) in a 30-day period, how many per minute, how many at once, and how many webhook endpoints it may register. The four plans are Free, Builder, Scale and Enterprise.

Two things make these plans different from the usual API pricing page:

- **The numbers are enforced, not just recorded.** The gate runs in the shared v1 gateway, so every v1 route respects it without knowing it exists. A call past the burst or concurrency ceiling is refused with 429 and `Retry-After`. The call that would exceed the period quota is refused with 402, is not counted, and the body names the next plan up and where to upgrade.
- **The numbers live in one file.** `api/_lib/dev-plans/config.js` is the only place a plan's included calls, burst rate, concurrent limit, webhook count and price are written. The public page at [/developers](https://three.ws/developers), the dashboard, the gateway headers, the checkout prices and the 402 body all read it at request time. This document deliberately quotes none of them; read `GET /api/v1/dev-plans` for the live table.

Developer plans are separate from the product plans (hosted agents, storage, free-model messages) and from the `$THREE` holding ladder, which is a loyalty feature. A plan governs calls to the API and nothing else.

## See the plans

```bash
curl -s https://three.ws/api/v1/dev-plans | jq '.data'
```

```json
{
	"plans": [
		{ "id": "free", "name": "Free", "price_usd": 0, "three_price_usd": 0, "included_calls": 10000, "burst_per_minute": 60, "concurrent": 4, "webhooks": 2, "purchasable": false, "contact_sales": false, "rank": 0 },
		{ "id": "builder", "name": "Builder", "price_usd": 29, "three_price_usd": 23.2, "included_calls": 250000, "burst_per_minute": 600, "concurrent": 16, "webhooks": 10, "purchasable": true, "contact_sales": false, "rank": 1 }
	],
	"period_days": 30,
	"three_discount_bps": 2000,
	"pay_assets": ["credits", "USDC", "THREE"],
	"upgrade_url": "/developers",
	"manage_url": "/dashboard/developers#plan",
	"calculation_note": "Prices are per 30-day period and are read from the plan configuration at request time; …"
}
```

The values above are an example response captured when this page was written. The live endpoint is authoritative, and `calculation_note` is generated from the same config so the sentence can never disagree with the numbers.

## What every v1 response tells you

| Header | Meaning |
| --- | --- |
| `x-plan` | The plan id in force |
| `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` | Sliding one-minute burst window: ceiling, calls left, Unix seconds when it refills |
| `x-quota-limit`, `x-quota-used`, `x-quota-remaining`, `x-quota-reset` | Period quota: included calls, used, left, Unix seconds when the period rolls over |
| `x-concurrency-limit` | Calls allowed in flight at once |

A client that reads `x-quota-remaining` and `x-ratelimit-remaining` can pace itself and never see a refusal.

## What a refusal looks like

**Burst ceiling** (too many calls in one minute): HTTP 429, `Retry-After` in seconds, `error` of `rate_limited`.

**Concurrency ceiling** (too many calls in flight): HTTP 429, `Retry-After: 1`, `error` of `concurrency_limited`, `concurrent_limit` in the body. Each in-flight call holds a slot until its response ends, so the ceiling is about parallelism, not rate.

**Quota used up**: HTTP 402, `error` of `quota_exceeded`:

```json
{
	"error": "quota_exceeded",
	"error_description": "the Free plan includes 10,000 calls per period and this period's calls are used up",
	"plan": "free",
	"limit": 10000,
	"used": 10000,
	"reset_at": "2026-11-09T12:00:00.000Z",
	"upgrade_url": "/developers",
	"manage_url": "/dashboard/developers#plan",
	"next_plan": { "id": "builder", "name": "Builder", "included_calls": 250000, "price_usd": 29 }
}
```

The quota is exact: the call that makes `used` equal `limit` succeeds with `x-quota-remaining: 0`, and the next one is refused without being counted. Two calls racing for the last slot cannot both pass, because the counter is a single atomic increment (Redis when configured, a row lock in Postgres otherwise). When the period ends the counter resets and the new period starts exactly where the old one ended, so a quiet account's period boundaries never drift.

A signed-in browser session browsing its own dashboard is held to the burst and concurrency ceilings but spends no quota; only keys and tokens consume included calls.

## Live usage in the dashboard

[Dashboard → Developers → Plan](https://three.ws/dashboard/developers#plan) shows the plan in force, the period, calls used against the quota as a bar that turns amber at 80 percent and red at the limit, calls in flight against the concurrency ceiling, the burst ceiling, any change scheduled for the period end, and every receipt. The 402 body's `manage_url` deep-links there.

Over the API the same facts come from `GET /api/v1/me/dev-plan`:

```bash
curl -s https://three.ws/api/v1/me/dev-plan -H 'Authorization: Bearer sk_live_…' | jq '.data.quota'
```

```json
{ "limit": 10000, "used": 4183, "remaining": 5817, "reset_at": "2026-11-09T12:00:00.000Z" }
```

That call is a v1 call, so a key asking about its own quota spends one call of it.

## Upgrade, downgrade, cancel

Plan changes are made from the dashboard with a signed-in session and a CSRF token; an API key can read its plan but never buy one. Three payment assets are accepted:

| Asset | How it settles |
| --- | --- |
| Credits | Debited from your prepaid balance in the same request. The receipt comes back immediately, and the plan renews from credits each period while the balance covers it. |
| USDC on Solana | The server builds an unsigned transfer to the platform treasury for the quoted amount. Your own wallet signs and sends it after showing you the recipient, amount, asset and chain. The server never holds or signs with a user key. |
| `$THREE` on Solana | Same flow as USDC, priced at the listed price less the configured discount (published in `three_discount_bps` on the catalog). |

**Proration.** An upgrade mid-period charges only for the days left in the period (`remaining_fraction` on the quote), and the new plan's full quota applies at once. Renewing the current plan buys the next period at the full price. A quote is held for ten minutes; a transfer signed after that is refused with `checkout_expired`, and no funds move because nothing was signed.

**Downgrades** never take effect mid-period. Scheduling a lower plan (or Free, which is a cancellation) marks it for the period end; until then the current plan and its quota stay in force. Scheduling the current plan again cancels the pending change.

**Renewal.** A plan paid from credits renews itself from credits at the period end. A plan paid by wallet cannot be charged again without your signature, so it lapses to Free when the period ends unless you renew it from the dashboard first; you are notified either way.

**Receipts.** Every settlement writes a receipt (plan, amount, asset, transaction signature or ledger id, period covered) that is listed on the Plan tab, returned by `GET /api/v1/me/dev-plan/receipts`, and sent by email. A wallet payment is idempotent on its signature: confirming the same transaction twice returns the same receipt.

### The wallet flow over the API

1. `POST /api/v1/me/dev-plan/checkout` with `{ "plan": "builder", "asset": "USDC", "wallet": "<your Solana address>" }`. The response holds `checkout` (`pay_to`, `amount_atomics`, `amount_usd`, `chain: "solana"`, `expires_at`) and `tx_base64`, the unsigned transfer.
2. Review the recipient, amount, asset and chain, then sign and send `tx_base64` with your wallet.
3. `POST /api/v1/me/dev-plan/confirm` with `{ "checkout_id", "tx_signature" }`. While the chain is still confirming the answer is HTTP 202 `{ "status": "pending", "reason" }`; poll again. Once confirmed it answers `{ "status": "paid", "receipt" }` and the plan is in force.

## Keys: revocation, rotation, allowlists, analytics

**Revocation is immediate.** A key is cached in memory for thirty seconds between database reads so that authentication is cheap. Revoking a key, rotating it or editing its allowlist invalidates that entry on every server instance at once, so the next call with a revoked key is refused. The window is bounded by the one-second invalidation refresh, not by the cache. A test pins this: a revoked key served from the cache is refused on the very next call after the invalidation.

**Rotation with an overlap window.** [Dashboard → API](https://three.ws/dashboard/api) → Rotate, or `POST /api/keys/:id/rotate` with `{ "overlap_hours": 24 }` (0 to 168). A replacement key with the same name, scopes, preset, expiry and allowlist is minted and shown once. The old key keeps answering until `overlap_until`, then reads as revoked, so you deploy the new secret at your own pace and nothing goes dark in between. The table shows `Overlap` with the time left while both keys work, and `Retired` once the window closes.

**IP allowlists.** Dashboard → API → IPs, or `PUT /api/keys/:id/allowlist` with up to 64 IPv4 or IPv6 addresses or CIDR ranges. A call from an address outside the list is refused as `unauthorized` before any scope or quota check. An invalid rule is named and nothing is saved; an empty list removes the lock.

**Per-key analytics.** Dashboard → API → Analytics, or `GET /api/keys/:id/analytics?days=7` (1, 7, 30 or 90): calls, error rate, p50, p95 and p99 latency, a daily series, the same broken down by route, and the top calling addresses. The numbers come from the same usage events that meter the quota.

## Where it lives

| Piece | Location |
| --- | --- |
| Plan table, calculation note, `$THREE` discount | `api/_lib/dev-plans/config.js` |
| Gate (burst, concurrency, quota, headers, 429 and 402) | `api/_lib/dev-plans/quota.js`, called from `api/_lib/gateway.js` |
| Subscriptions and period rollover | `api/_lib/dev-plans/subscription.js` |
| Quotes, checkouts, confirmation, receipts | `api/_lib/dev-plans/billing.js` |
| Per-key analytics | `api/_lib/dev-plans/analytics.js` |
| Key cache and immediate invalidation | `api/_lib/api-key-cache.js` |
| Allowlist parsing and matching | `api/_lib/ip-allowlist.js` |
| Routes | `api/v1/dev-plans.js`, `api/v1/me/dev-plan/*`, `api/keys/[id]/{rotate,allowlist,analytics}.js` |
| Public page | `pages/developers.html` → [/developers](https://three.ws/developers) |
| Dashboard | `src/dashboard-next/pages/developers-plan.js` (Plan tab), `src/dashboard-next/pages/api-key-tools.js` (key tools) |
| Tests | `tests/dev-plans-quota.test.js` (exactly at limit, concurrent calls, period rollover, renewal), `tests/dev-plans-config.test.js`, `tests/api-key-cache.test.js` (revocation immediacy, allowlist), `tests/ip-allowlist.test.js` |

The endpoint reference is in [the API reference](./api-reference.md#developer-plans-and-quotas).
