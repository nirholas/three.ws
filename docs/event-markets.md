# Event Markets

A free-to-play "who wins this?" market for every three.ws event, with the entrants as outcomes. Picks carry points, never funds. Build briefs: [docs/prompts/event-markets/](prompts/event-markets/README.md). Core module: `api/_lib/event-markets/`.

## Markets, picks and odds (core)

Everything else in this guide sits on one seam: `api/_lib/event-markets/index.js` (`createMarket`, `getMarket`, `listMarkets`, `placePick`, `withdrawPick`, `getPicks`, `marketHistory`, `lockMarket`, `voidMarket`, `resolveMarket`, `impliedOdds`). Tables: `event_markets`, `event_market_outcomes`, `event_market_picks`, `event_market_pick_log` (migration `20261011020000_event_markets.sql`). Numbers live in [data/event-markets.json](../data/event-markets.json).

**Status.** `draft`, `open`, `locked`, `resolved`, `void`. An open market past `locks_at` reads as `locked` immediately, even before the lifecycle cron runs. The lock check also runs inside the write statement against the database clock, so a pick at or after `locks_at` is refused with `market_locked` and a message that names the closing time.

**Odds.** Each outcome's share is `(points + k) / (total + k * n)`, with `k` = `odds.prior_points_per_outcome` (25) and `n` outcomes. With zero picks every share is `1/n` and the market says so (`odds.even_prior: true` and a note). The method string ships in every response.

**Points.** A pick is 10 to 250 points on one outcome. One live pick per account per market: a new pick replaces the old one until lock, and withdrawing frees the points. Each account also has a season budget (1000 points per UTC calendar quarter of the market's lock time) across all its live picks; past it, the pick is refused with `budget_exceeded` and the points left. Voiding a market refunds every live pick, so the points return to the budget. Overrides per season: `season_budget_overrides` in the config.

**History.** `GET /:slug/history` replays the append-only pick log (`place`, `change`, `withdraw`, `void`) and returns the odds after each event, plus the opening even prior. There are no invented points.

**Fairness at pick time.** Each pick stores `odds_at_pick` and `ranked`, which the scoring rollup reads.

### REST

Base `/api/event-markets`, v1 envelope `{ data, meta }`.

| Method and path | Auth | What it does |
|---|---|---|
| `GET /` | public | List. Filters `status` (default `open`), `source_kind`, `q`; `limit`, `cursor`. Closing soonest, then most picks. |
| `GET /:slug` | optional | One market with outcomes, odds, and, signed in, your pick and budget. |
| `GET /:slug/history` | public | Odds over time from the pick log. |
| `GET /:slug/picks` | session | Your picks on this market. |
| `POST /:slug/pick` | session | `{ outcome_id, points }`. Places or changes your pick. |
| `DELETE /:slug/pick` | session | Withdraws your pick before lock. |
| `POST /` | admin | Create a market. |
| `PATCH /:slug` | admin | Edit title, description, times, outcomes. |
| `POST /:slug/lock` | admin | Close picks now. |
| `POST /:slug/void` | admin | `{ reason }`. Voids and refunds every live pick. |
| `POST /:slug/resolve` | admin | `{ winner_outcome_id }`. |

Writes are limited per account (30 per 5 minutes) and per IP (60 per 5 minutes) and return `429 rate_limited` with `retryAfterSeconds`. Errors carry a stable `code`: `market_locked`, `market_not_open`, `budget_exceeded`, `invalid_points`, `outcome_not_found`, `pick_not_found`, `slug_taken`, `market_exists_for_source`, `invalid_transition`, `already_resolved`.

### MCP

On the Agent Wallet server (`/api/mcp-agent`): `event_markets_list` and `event_market` (reads), and `event_market_pick`, which refuses unless `confirm: true`, so an assistant states the market, outcome and points to its owner first. Source: [api/_mcpagent/event-markets-tools.js](../api/_mcpagent/event-markets-tools.js). Tests: [tests/event-markets.test.js](../tests/event-markets.test.js), [tests/event-markets-mcp.test.js](../tests/event-markets-mcp.test.js).

## Announcements

A market that is not announced does not get picks, and the announcement is what tags the entrants so they show their own audiences. The announcement lane writes the drafts, holds them for review, and sends only what the owner approved.

### The flow

1. **Cron drafts.** `/api/cron/event-market-announce` (every 15 minutes) scans open, locked and resolved markets and writes a draft per kind that is due. It never posts and never approves. It reads market state directly (status, lock time, picks), so a missed tick catches up on the next one.
2. **Review.** `/admin/event-market-announcements` lists drafts. Edit, reject, approve one, or approve a batch in one action. Editing sends an approved draft back to review, so the text that goes out is always the text that was approved.
3. **Send.** `api/_lib/event-markets/poster.js` is the only sender. It refuses anything not `approved`, re-checks the text, enforces the daily cap, and sends nothing unless the flag is on and the call is not a dry run.

### Kinds

| Kind | When | Content |
| --- | --- | --- |
| `opened` | the market is open | the question, the entrants (tagged where linked), the link |
| `locking_soon` | within `lockingSoonHours` of the lock | time left, the current leader and its share, or an honest "no picks yet" |
| `odds_shift` | the leader changed, or gained `oddsShiftPoints` since the market opened, with at least `minPicksForOddsShift` picks | the new leader and pick count |
| `resolved` | a winner is set | the winner, the crowd's share, the first forecasters to call it, the market page as evidence |

One announcement per kind per market, enforced by a unique key on `(market_id, kind)`. A rejected draft is a decision and is not refilled. Numbers live in `data/event-markets-announcements.json`.

### Tagging rules

- A handle is tagged only when the entrant linked it to their own account through X OAuth: an agent's own connection (`agent_x_connections`), else its owner's (`social_connections`). Handles are never scraped, guessed or typed in by an admin: an edit may not add an `@` mention that is not in the draft's `tags`.
- An entrant with no linked handle is named, not tagged.
- An entrant who opted out (`event_market_entrant_prefs`) is neither tagged nor featured. The drafter reads `taggableEntrants`, the same source the entrant notifications use.
- At most three tags per post, dropped last-first until the post fits 280 characters.

### Voice

Every draft passes the house editorial lint (`api/_lib/x-content/editorial.js`: brand spelling, no price promises, no slang, no engagement asks). Copy is positive and states only what the market's own data says. No other coin is named.

### Enabling posting (owner steps)

Posting is off by default. Dry run is always safe:

```
POST /api/event-markets/announcements  { "action": "send", "id": "<uuid>" }
```

It returns `would_send.text`, the exact text and the call a live send would make, and changes nothing. To send for real, the owner approves the drafts in the queue, then enables the flag and sends with `dry_run: false`:

```
gcloud run services update three-ws-api --region us-central1 --update-env-vars EVENT_MARKET_ANNOUNCE_POST=on
POST /api/event-markets/announcements  { "action": "send", "id": "<uuid>", "dry_run": false }
```

What the owner must approve: (1) the posts themselves, one by one or as a batch in the queue, and (2) turning the flag on. Posts go out from @trythreews through the same `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` credentials as the x-content publisher. A daily cap (`dailyCap`, default 4 posts per rolling 24 hours) applies on top.

### Table

`event_market_announcements`: `market_id`, `kind`, `draft_text`, `card_url`, `tags`, `status` (`draft`, `approved`, `posting`, `posted`, `rejected`), `approved_by`, `posted_at`, `post_url`, `baseline` (odds snapshot at draft time). `posting` is the poster's in-flight claim, so two ticks never send one draft twice.

Tests: [tests/event-market-announcements.test.js](../tests/event-market-announcements.test.js).

## Which events get a market

The cron `/api/cron/event-markets-open` (every 10 minutes) reads our own tables through one adapter per source in [api/_lib/event-markets/sources/](../api/_lib/event-markets/sources/) and opens "Who wins X?" for every event that has none. It is idempotent on `(source_kind, source_ref)`, so a second run changes nothing.

| Source | Event | Entrants | Locks | Resolves |
| --- | --- | --- | --- | --- |
| `arena_tournament` | upcoming or live tournament | agents entered | 10% into the window | tournament end |
| `event_leaderboard` | the `/play` platform event | wallets with a run | 20% into the window | event end |
| `build_round` | open or judging program round | agents with a submission | round `ends_at` | `judging_ends_at`, else `ends_at` |
| `bounty` | open bounty | submissions | `expires_at` | 7 days after expiry |

Lock fractions and limits live in [data/event-market-autoopen.json](../data/event-market-autoopen.json).

Launch cohorts and seasons have no source: no table holds their entrants together with a defined winner, so no adapter exists. Add one in `sources/` when such a table lands.

**Late entrants.** While a market is open and before lock, each run adds entrants it does not have yet as new outcomes. Existing outcomes and picks are never touched, and nothing changes after lock.

**Skips.** An event is skipped, and the reason recorded in `event_market_skips`, when it has fewer than two entrants (`too_few_entrants`), no defined winner (`no_defined_winner`, for example a round with no judging criteria), or its lock time has already passed (`lock_passed`). A skip clears itself when the event qualifies.

**Outbox.** Each opened market writes one `event_market.opened` row to `event_market_outbox` (unique per market). Consumers read it; nothing is called in process.

**Admin.** `/admin/event-markets` lists events with and without markets and the skip reasons. An admin can open a skipped or past-lock event by hand (it gets a fresh lock window, 60 minutes by default) or void a market, which refunds live picks.

## How markets resolve

The cron `/api/cron/event-markets-resolve` (every 5 minutes) is the whole lifecycle: it locks open markets at `locks_at`, asks the market's resolver for a result at or after `resolves_at`, and retries every tick while the source says "not yet". Resolvers live in [api/_lib/event-markets/resolvers/](../api/_lib/event-markets/resolvers/), one module per `source_kind`, each exporting `describe(rule)` (the sentence shown on the market page) and `resolve(market)`, which returns exactly one of a winner with its evidence, `pending`, or `void` with a reason. Only our own records are read.

**Evidence.** The winner, the status change and the inputs the resolver read (ids, values, timestamps) are written in one statement into `event_markets.resolution_evidence`, so a settled market always carries its proof. The market page shows it under "How this resolved". Account keys are hashed in the evidence (`account_ref`), never published.

**Idempotence.** Every write is guarded by the market's current status. A resolved or void market is never a candidate again, and a tick that loses a race changes nothing. Points are scored from the resolved market by the rollup ([rollup.js](../api/_lib/event-markets/rollup.js)), whose ledger insert is unique per `(market, account)`, so a pick is never awarded twice. The resolve cron runs the rollup right after it settles anything.

**Timeouts.** A market whose source has not produced a result a set number of hours after `resolves_at` is voided with reason `resolution_timeout` and every pick refunded, so no market is ever stuck. The hours per kind are in [data/event-market-resolution.json](../data/event-market-resolution.json): arena 72, event leaderboard 72, launch cohort 48, build round 336, bounty 720, custom 168.

**`arena_tournament`.** Winner is rank 1 of the tournament's final standings, computed by the same `loadStandings` the Arena page and the podium attestation use, as of the window end, once the tournament is closed or settled (until then: pending). Ranking is the tournament's scoring metric, then realized P&L, then closed-trade count; an entrant with no closed trade never outranks one that traded. An exact tie on all three, or no entrant with a closed trade, voids the market (`tie`, `no_data`). A cancelled tournament voids it (`event_cancelled`).

**`event_leaderboard`.** Winner is rank 1 on the event board at the window end, using the board's own order (best cash, then more runs, then earliest last run). Nobody played: void (`no_data`). The window end is `rule.ends_at`, else the configured event's end, else `resolves_at`. A rank 1 who is not one of the market's wallet outcomes voids it (`winner_not_an_outcome`).

**`launch_cohort`.** Rule: `{ metric: volume | holders | market_cap, network, window_from, measure_at }`. Winner is the outcome with the highest value at `measure_at`, from three.ws launch records only: SOL-paired trades for volume, the latest price point at or before `measure_at` for market cap, and holder snapshots for holders. A project outcome is its mint; an agent outcome counts its best launch. Launches without a record are excluded and listed in the evidence. Equal top values void it (`tie`); no positive value voids it (`no_data`).

**`build_round`.** Winner is the first-place submission once the round is closed (pending while it is running or in judging). With a `track_id` rule only that track counts. Several first places are broken by the higher judged score; equal scores void it (`tie`). A closed round with no recorded winner voids it (`no_winner_recorded`).

**`bounty`.** Winner is the submission the poster accepts. Pending while the bounty is open; a deleted bounty voids it (`event_cancelled`); a bounty closed without a winner voids it (`no_winner_recorded`). If the poster never decides, the timeout voids it.

**`custom`.** No data source. It stays pending until an admin records the result (below) or the timeout voids it.

**Disputes.** `POST /api/ops/event-market-override` (admin session) takes `{ market_id, action: 'set_winner' | 'void', winner_outcome_id?, reason }`. `reason` (20 to 1000 characters) is mandatory. The market, its refunds, the removal of the score rows it had produced and the log row in `event_market_overrides` change in one statement; the rollup then re-scores from the new result. Overrides show on the market page with their reason and the result they replaced. A void market is final. The default path never needs this route.

**Check a resolver against real data.** `node --env-file=.env.local scripts/event-markets-resolve-dry-run.mjs [kind]` runs each resolver, read only, against finished records in our tables and prints the result and evidence.

Tests: [tests/event-market-resolvers.test.js](../tests/event-market-resolvers.test.js), [tests/event-market-lifecycle.test.js](../tests/event-market-lifecycle.test.js). Migration: `20261012130000_event_market_resolution.sql` (apply with `npm run db:status` first, then the owner-approved migrate).

## Pages and share cards

| Surface | URL | What it does |
| --- | --- | --- |
| Browse | `/event-markets` | Live, Closing soon (locks within 24 hours) and Resolved views. Filters by source kind, debounced search, load more. Designed loading, empty and error states. |
| Market | `/event-markets/<slug>` | Entrants with implied-odds bars and profile links, odds over time, lock countdown, the plain-language resolution rule, and after resolution a winner banner with your result. |
| Share card | `/api/event-market-og?m=<slug>[&pick=<outcome id>]` | SVG 1200x630 rendered from the live market: the question, top three entrants with odds, time left. With `pick` the headline reads "Pick Name to win". An unknown market returns a branded card, never a 404. |
| Crawlable page | `/api/event-market-share?m=<slug>` | Server-rendered Open Graph and Twitter meta pointing at the card, a text summary, then a hand-off to the live page. `/event-markets/<slug>` is routed here, so a pasted URL unfurls with the current odds. |

The market page itself is the SPA at `/event-markets/view?m=<slug>`; the crawlable page forwards to it.

**Pick flow.** Choose an entrant, set points, confirm. The odds update in place from the response; there is no reload. Signed-out visitors see the whole market and are asked to sign in only when they press Pick. Everything is reachable by keyboard: tabs use arrow keys, the pick dialog is a native modal `dialog`, the chart steps with the arrow keys and has a table view, and results are announced in a live region.

**Sharing.** Copy link, Post on X (the intent carries the market URL, which unfurls the card), and Challenge a friend: `/event-markets/<slug>?pick=<outcome id>` opens the market with a banner showing the sharer's pick and a card that reads "Pick Name to win".

**Entry points.** The nav (Play, next to The Arena), the Arena tournament page, the `/event` page, `/launches` (launch cohort markets) and the home page, each through `src/event-markets/entry-strip.js`. A strip renders nothing when there is no open market, so no surface shows an empty promo.

Code: [src/event-markets/](../src/event-markets/), [api/event-market-og.js](../api/event-market-og.js), [api/event-market-share.js](../api/event-market-share.js), [api/_lib/event-market-card.js](../api/_lib/event-market-card.js). Tests: [tests/event-market-card.test.js](../tests/event-market-card.test.js).
