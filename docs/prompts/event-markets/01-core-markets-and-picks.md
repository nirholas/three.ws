# 01. Core markets and picks API

Read `docs/prompts/event-markets/README.md` first. It defines the shared contract this brief builds.

## The problem

Events run on three.ws with no market layer. There is no object that says "this event has a winner to call, these are the entrants, and here is what the crowd thinks."

## Build

1. Check for `api/_lib/event-markets/`. If it exists, read it and extend it. If not, create the contract from the README: migration, module, tests.
2. `api/event-markets.js` router with public reads:
   - `GET /api/event-markets` (filters: `status`, `source_kind`, `q`; cursor pagination; sorted by closing soonest, then most picks).
   - `GET /api/event-markets/:slug` (market, outcomes with implied odds, pick count, time to lock, resolution rule in plain words, and the winner once resolved).
   - `GET /api/event-markets/:slug/history` (odds over time, derived from the picks log, no invented points).
3. Session-required writes: `POST /api/event-markets/:slug/pick` (outcome, points within a per-account budget, change allowed until lock, rejected after), `DELETE` to withdraw before lock. Rate limited per account and IP like the other write routes. Validate everything at the boundary.
4. Admin write: create, edit, lock, void a market (reuse the admin auth the other admin routes use). Void refunds points.
5. MCP tools on the existing agent MCP endpoint, registered under the shared tool policy (`packages/mcp-policy`): `event_markets_list`, `event_market`, `event_market_pick`. Picks are not financial, but still take an explicit confirm flag so an agent cannot pick by accident.
6. Points budget: define one source of truth for how many points an account has per market and per season. Store it in `data/` config, not in code constants scattered across files.

## Docs and wiring

`docs/event-markets.md` (new, linked from `docs/start-here.md`), `docs/api-reference.md` section, `STRUCTURE.md` row, `data/changelog.json` entry tagged `feature`, route entry in `vercel.json` the way sibling routers are wired.

## Acceptance

- Create a market with three outcomes through the admin route, pick as two different accounts, and see odds move on the public read.
- A pick after `locks_at` is rejected with an actionable error.
- A zero-pick market returns an even prior and says so.
- Tests cover the contract, the lock boundary, the budget and the void path. `npm test` green.
