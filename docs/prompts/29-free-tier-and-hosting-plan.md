# 29. Free agent hosting tier, published pricing, and rate limits

Read `docs/prompts/README.md` first.

## The problem

Plans, quotas, invoices and credits exist under `api/billing/` and `api/credits/`, but there is no clearly stated free tier that lets someone deploy a hosted agent at no cost with model usage billed separately, no single pricing page that lists every metered thing, and rate limits are not published. Competitors lead with "free agent deployment with hosting" and a model-usage line item.

## Build

- **Free tier:** one hosted agent per account with wallet, page, chat, runs within a small daily credit allowance on the free models from prompt 18, automations capped, community skills unlimited. Defined in `data/plans.json` (single source for the UI, the quota checks, and the docs) and enforced by the existing quota path in `api/usage/summary.js`.
- **Pricing page** `/pricing` rebuilt from `data/plans.json`: plans, every metered item (model tokens per model, gateway tools, sandbox minutes, mail sends, card fees, marketplace fees, launch fees) with prices, the free-tier allowance, and the rate limits per plan. Every state designed.
- **Rate limits:** per-plan limits enforced in `api/_lib/rate-limit.js`, returned as `RateLimit-*` headers on every API route and surfaced in the SDK error from prompt 06; documented in `docs/api-reference.md`.
- **Upgrade path:** in-product prompts when a cap is hit, with the exact action, never a dead end; self-serve API keys with no email approval step.
- Docs: `docs/pricing.md` linked from `docs/start-here.md`; changelog entry tagged `feature, docs`.

## Acceptance

- A new account creates and chats with an agent without paying.
- Hitting the free automation cap shows the upgrade state with a working action.
- Headers and docs match `data/plans.json` (a test asserts it).
- `npm test` green.
