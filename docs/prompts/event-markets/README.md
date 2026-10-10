# Event Markets: build briefs

Read `CLAUDE.md` and `docs/prompts/README.md` first. Every brief here is a complete task for one fresh chat. They are written to run in any order, at any time, in parallel.

## The idea

Every event on the platform (a hackathon, a launch cohort, a tournament, an agent competition, a leaderboard season) gets a market: "who wins this?", with the entrants as outcomes. The market is the content. It is quoted, shared and argued over for the whole event, every entrant has a reason to promote it to their own audience, and it is opened and announced automatically the moment an event exists.

Today we run the events but have no layer that turns "an event is happening" into "here is a market to call it, and a post announcing it".

## Name and collisions

The feature is called **Event Markets**. Do not call it "Arena": that name belongs to the live trading tournaments (`docs/trading-arenas.md`, `api/arena-og.js`, `/arena`). Do not duplicate the venue-backed prediction market surface either (`docs/predictions.md`, `/predictions`, `api/predictions/`, `api/_lib/predictions/`): that is for trading on external venues from an agent wallet. Event Markets are about OUR events, resolved from OUR data. Link between the two where it helps a user, never merge them.

## The shared contract (how independence works)

All briefs agree on one seam. The first brief to run creates it; every later brief finds it and reuses it. Before building, check whether it exists. If it does, read it and build on it. If it does not, create exactly this minimal seam first (a few files, with tests), then do your brief on top.

- Module: `api/_lib/event-markets/` with `index.js` exporting `createMarket`, `getMarket`, `listMarkets`, `placePick`, `getPicks`, `resolveMarket`, `impliedOdds`.
- Tables (migration in `db/migrations/`, read `npm run db:status` before `npm run db:migrate`, which applies immediately):
  - `event_markets`: `id`, `slug` (unique), `title`, `source_kind` (`arena_tournament`, `event_leaderboard`, `launch_cohort`, `build_round`, `bounty`, `custom`), `source_ref`, `status` (`draft`, `open`, `locked`, `resolved`, `void`), `opens_at`, `locks_at`, `resolves_at`, `resolution_rule` (jsonb), `winner_outcome_id`, `created_by`, timestamps.
  - `event_market_outcomes`: `id`, `market_id`, `label`, `ref_kind` (`agent`, `wallet`, `project`, `team`), `ref_id`, `image_url`, `position`.
  - `event_market_picks`: `id`, `market_id`, `outcome_id`, `account_id`, `points` (free-to-play weight), `created_at`; one live pick per account per market, changeable until lock.
- Free-to-play first. Picks carry points, not funds. Nothing in this seam signs, escrows or moves anything. The staked leg is its own brief and is owner-gated.
- Odds: `impliedOdds` is the pick-weighted share per outcome with a stated smoothing prior, never a fabricated number. Zero picks yields an even prior and the UI says so.
- Routes: public reads under `api/event-markets.js` (router style of `api/predictions/[...path].js`); writes require a session.

## Rules that apply to every brief

- `CLAUDE.md` governs. Solana first. No mocks, no sample arrays, no TODOs. Real data from our own tables and endpoints.
- Never name a third-party token or competitor in committed code, fixtures, docs or copy. Entrants are whatever our own records say. `$THREE` is the only coin promoted.
- Nothing posts to an external channel, deploys, or moves funds without the owner's explicit yes (gates 1 and 2). Prepare everything so the final step is one command.
- Each brief ends only when the definition of done in `CLAUDE.md` holds: reachable in the UI, exercised in a real browser, `npm test` green, docs, `data/changelog.json` entry, `data/pages.json` row for every new page, `STRUCTURE.md` row, `npm run audit:docs` and `npm run check:rules -- --paths <your files>` clean.
- Commit your own finished work with explicit paths and a message that describes the diff.

## Briefs

| # | Brief | What it ships |
|---|---|---|
| 01 | [Core markets and picks API](01-core-markets-and-picks.md) | The contract above, REST reads and writes, MCP tools |
| 02 | [Market pages and share cards](02-market-pages-and-share-cards.md) | `/event-markets`, market detail, OG card |
| 03 | [Auto-resolution from our own data](03-auto-resolution.md) | Resolvers per source kind, lock and settle cron |
| 04 | [Auto-open a market for every event](04-auto-open-for-every-event.md) | Cron that creates and populates markets |
| 05 | [Announcement automation](05-announcement-automation.md) | Draft queue, entrant tagging, owner-approved posting |
| 06 | [Entrant amplification kit](06-entrant-amplification-kit.md) | Per-entrant share kit, embed widget, notifications |
| 07 | [Pick leaderboard, streaks and rewards](07-pick-leaderboard-and-rewards.md) | Forecaster rankings, streaks, reward rail |
| 08 | [Live odds feed and ticker](08-live-odds-feed.md) | Streaming odds, pulse integration, activity ticker |
| 09 | [Agents as forecasters](09-agents-as-forecasters.md) | Agent picks, reasoning, public track record |
| 10 | [Staked markets on Solana](10-staked-markets-solana.md) | Escrow design, program, devnet, stops at the gate |
