# Agent Monetization — Feature Overview & Task Index

## What This Feature Does
Allows agent owners on Three.ws to charge callers for skill invocations. Revenue flows to the owner's configured payout wallet (Solana USDC or Base USDC), minus a configurable platform fee (default 2.5%). Owners can track earnings and request withdrawals from the dashboard.

## User Stories
- **As an agent owner**, I can set a price (in USDC) for each skill my agent offers
- **As an agent owner**, I can see how much I've earned, broken down by skill and over time
- **As an agent owner**, I can withdraw my earnings to my Solana or Base wallet
- **As a caller**, I see the price before invoking a paid skill and can approve or cancel
- **As a caller browsing the marketplace**, I can see which agents have paid skills at a glance

## Architecture Summary
- Pricing stored in `agent_skill_prices` table (per agent, per skill)
- x402 manifest endpoint reads live pricing from DB
- Payment intents (existing `agent_payment_intents`) are consumed; revenue recorded in `agent_revenue_events`
- Platform fee calculated at event time (`fee_bps` from `PLATFORM_FEE_BPS` env var)
- Withdrawals queued in `agent_withdrawals`, processed by a Vercel cron every 15 minutes
- All revenue scoped by `agent_identities.user_id` for authorization

## Task Index

| # | Task | Description | Depends On |
|---|------|-------------|------------|
| 01 | [DB Schema](01-db-schema.md) | 4 new tables: prices, revenue, payout wallets, withdrawals | — |
| 02 | [Pricing API](02-pricing-api.md) | CRUD for per-skill prices | 01 |
| 03 | [x402 Manifest Update](03-x402-manifest-update.md) | Dynamic pricing in payment manifests | 01, 02 |
| 04 | [Revenue Attribution](04-revenue-attribution.md) | Write revenue events on intent consumption | 01, 03 |
| 05 | [Payout Wallet API](05-payout-wallet-api.md) | CRUD for payout wallet addresses | 01 |
| 06 | [Revenue Dashboard API](06-revenue-dashboard-api.md) | Aggregated earnings data endpoint | 01, 04 |
| 07 | [Withdrawal API](07-withdrawal-api.md) | Request and track payouts | 01, 05, 06 |
| 08 | [Monetization Settings UI](08-monetization-settings-ui.md) | Agent editor Monetization tab | 02, 05 |
| 09 | [Caller Payment Gate](09-caller-payment-gate.md) | Frontend intercept for paid skill invocations | 03 |
| 10 | [Revenue Dashboard UI](10-revenue-dashboard-ui.md) | Earnings charts and summary cards | 06 |
| 11 | [Withdrawal UI](11-withdrawal-ui.md) | Request payout from the dashboard | 07, 10 |
| 12 | [Platform Fee Config](12-platform-fee-config.md) | Fee rate exposure and admin revenue view | 04 |
| 13 | [Marketplace Pricing Display](13-agent-marketplace-pricing-display.md) | Show prices on agent cards and detail pages | 02 |
| 14 | [SDK Payment Support](14-sdk-payment-support.md) | Programmatic payment for SDK callers | 03 |
| 15 | [Cron: Withdrawal Processor](15-cron-withdrawal-processor.md) | On-chain USDC transfers for pending withdrawals | 07 |
| 16 | [Rate Limiting & Abuse](16-rate-limiting-and-abuse.md) | Rate limits on payment and withdrawal endpoints | 02, 07 |
| 17 | [Notifications](17-notifications.md) | Earnings and withdrawal alerts for owners | 04, 15 |
| 18 | [E2E Tests](18-e2e-tests.md) | Integration tests for the full flow | All above |
| 19 | [Security Review](19-security-review.md) | Pre-ship security checklist | All above |

## Recommended Implementation Order
1. Tasks 01–05 (backend foundation — no UI needed yet)
2. Tasks 06–07 (revenue and withdrawal APIs)
3. Tasks 08–11 (frontend — parallel with 12–14)
4. Tasks 12–14 (parallel work: fee config, marketplace, SDK)
5. Tasks 15–17 (cron, rate limits, notifications)
6. Task 18 (tests — add as you go, finalize last)
7. Task 19 (security review — gate on all above complete)

## Key Env Vars to Add
```
PLATFORM_FEE_BPS=250
PLATFORM_TREASURY_KEYPAIR=<base58-private-key>
```
