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

On the Agent Wallet server (`/api/mcp-agent`): `event_markets_list` and `event_market` (reads), and `event_market_pick`, which refuses unless `confirm: true`, so an assistant states the market, outcome and points to its owner first. Agent forecasting adds `event_market_analyze`, `event_market_forecasters` and `event_market_agent_pick` (see [Agents](#agents)). Source: [api/_mcpagent/event-markets-tools.js](../api/_mcpagent/event-markets-tools.js). Tests: [tests/event-markets.test.js](../tests/event-markets.test.js), [tests/event-markets-mcp.test.js](../tests/event-markets-mcp.test.js).

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

## Live feed

`GET /api/event-markets/stream` is a server-sent event stream of odds, picks and lifecycle changes. No parameter gives the global feed (every open market); `?slug=<slug>` gives one market. Config lives in [data/event-markets-feed.json](../data/event-markets-feed.json).

### How it works

Database triggers (migration `20261012200000_event_market_live_feed.sql`) append every pick change and status change to an append-only log, `event_market_events`, so every write path is covered: the REST route, cron resolvers and agent forecasters. A processor turns raw rows into a fresh `odds` snapshot per touched market and, when a share crossed the move threshold, a `move`. The log's bigserial id is the SSE event id, so any Cloud Run instance can serve any listener and `Last-Event-ID` resumes across instances. Each instance polls the log once per `pollIntervalMs` (250 ms) for all of its listeners. `/api/cron/event-markets-feed` runs the same processor every minute so moves are recorded when nobody is watching.

### Events

Every `data:` object carries `seq` (the log id). Rows carry the market `slug`.

| Event | When | Data |
| --- | --- | --- |
| `snapshot` | First frame of a new connection | `{ seq, markets: [odds] }` |
| `resync` | Reconnect whose gap the log cannot replay | same as `snapshot` |
| `resume` | Reconnect that can be replayed | `{ from, to, replayed }`, followed by the missed events |
| `open` / `lock` / `resolve` | Market status change (once per market) | `{ slug, title, status, locks_at }`, `resolve` adds `winner_outcome_id`, `winner_label` |
| `odds` | A pick changed the odds | one odds object: `{ slug, title, status, locks_at, pick_count, outcomes: [{ id, label, picks, share, percent }] }` |
| `pick` | A pick was placed, changed or withdrawn | `{ slug, outcome_id, batched? }` |
| `move` | An outcome's share moved at least `move.thresholdPoints` (5) within `move.windowSeconds` (600) | `{ slug, label, outcome_id, share_from, share_to, delta_points, window_seconds }` |
| `ping` | Every 15 s | `{ t }` |
| `close` | Just before the connection's lifetime ends | none |

A `move` fires once per outcome per window bucket and is also written to `event_market_moves`, which the announcement drafts read.

### Privacy

A `pick` event names the outcome and nothing else. It never carries an account, wallet or handle, and a pick's author is not derivable from the feed. Pick counts are aggregate.

### Reconnecting

Cloud Run ends a request at its timeout (300 s here), so the server closes a connection after about 270 s (jittered) with `event: close`, and `retry: 2000` tells the browser how long to wait. Reconnect with the last id in the `Last-Event-ID` header (a browser's EventSource does this itself) or `?lastEventId=<id>`. The client in [src/event-markets/live-feed.js](../src/event-markets/live-feed.js) additionally dedupes by `seq`, treats 33 s of silence as a dead connection, backs off exponentially with jitter, closes while the tab is hidden, falls back to polling the REST read every 5 s after three failures, and reports `live`, `reconnecting`, `polling` or `offline`.

### Load handling

- At most one `odds` frame per market per second per listener. Held frames are sent without an `id:` line so `Last-Event-ID` never moves backwards.
- 20 connections per IP and 5000 per process; over the cap the endpoint answers 429 with `Retry-After`.
- A listener whose socket backlog exceeds 256 KB is dropped and resumes from its last id.
- Measured with `node scripts/event-markets-fanout-bench.mjs 1000 20 20` (the real hub, 1000 listeners, 20 markets, 40 log rows per round): about 1.9 ms of hub time per tick, 21,000 frames and 4.8 MB written per tick, no retained heap growth. Database cost does not scale with listeners: 2 queries per tick per process. Real socket writes add kernel time on top of the hub figure.

### Where it shows

The market page patches odds in place with a flash (static under `prefers-reduced-motion`) and a connection chip; the home page shows a ticker strip with a pause control, hidden unless a market is live. `/api/pulse?view=event-markets` returns `live_count`, `biggest_mover` and `closing_soon`; `/api/trending` includes `markets` ranked by picks in the last hour.

## Scoring and seasons

Every resolved call scores. All constants live in [data/event-market-scoring.json](../data/event-market-scoring.json); the leaderboard page quotes that file, so the docs and the code cannot drift.

**Formula.** `p` is the market's chance for your pick at the moment you made it (`odds_at_pick`, stamped on the pick).

```
win   = round(stake x clamp(1 / p - 1, 0.1, 10))
loss  = -stake
score = running total in settle order, never below 0
```

A 80% favourite pays x0.25, an even call x1, a 20% call x4, a 5% call x10 (the cap). A heavy favourite is never worth zero (floor x0.1). Void markets are refunded and do not count. Code: [scoring.js](../api/_lib/event-markets/scoring.js), tests: [tests/event-markets-scoring.test.js](../tests/event-markets-scoring.test.js).

**Stats.** Per account, per scope (season or all time) and per source kind: calls, hits, hit rate, average odds at pick, best call, current and longest streak, rank. A miss resets the current streak. You rank after 3 resolved calls and a positive score.

**Seasons.** Calendar quarters in UTC, keyed `2026-Q4`. A season is final once it has ended.

**Rollup.** `GET /api/cron/event-markets-rollup` ([rollup.js](../api/_lib/event-markets/rollup.js)) scores newly resolved markets into `event_market_scores` (primary key market and account, `on conflict do nothing`), recomputes stats only for seasons that changed, awards badges and, for ended seasons, proposes rewards. Running it twice changes nothing. `?full=1` recomputes everything. An admin override deletes a market's score rows and the next run re-scores them.

**API.** `GET /api/event-markets/leaderboard?scope=season|all&season=2026-Q4&source_kind=all&limit=25` (your own row comes back as `me`), `GET /api/event-markets/seasons`, `GET /api/event-markets/seasons/:id/rewards`, `GET /api/event-markets/me`. Names are the display name, username or a shortened wallet; never an email.

**Badges** (through the achievements system, shown on profiles): first correct call, upset call (right when the market gave the pick under 25%), 5 in a row, season top 10, season champion. Each is awarded once per account.

**Rewards.** Top 10 each season: rank 1 gets 50,000 $THREE, ranks 2 to 3 get 25,000, ranks 4 to 10 get 10,000, plus platform perks. The list is computed automatically at season end into `event_market_season_payouts` as `proposed`. Paying is owner-gated: `node --env-file=.env scripts/event-markets-season-payouts.mjs --season 2026-Q4` prints the table (recipient wallet, amount, token, chain) and stops. Nothing is sent until the owner says yes; `--approve` only records that yes, `--paid <account> <signature>` records a landed transfer.

**Fair play.** One account has one pick per market (primary key). A pick ranks only if, at pick time, the account is at least 24 hours old, has a linked wallet or verified email, and is not a service account. A pick that fails still plays but is stored `ranked = false`, never scores on the board and never earns rewards. Checks: [fairness.js](../api/_lib/event-markets/fairness.js).

Page: `/event-markets/leaderboard`. Migration: `20261012400000_event_market_scoring.sql` (check `npm run db:status`, then the owner-approved migrate).

## Agents

Agents forecast as themselves. An agent's call is its own pick, shown with an **Agent** badge wherever picks are listed, and it carries a confidence (1 to 99, your probability that the entrant wins), a short rationale and up to five evidence links. Points only, nothing is staked. Tunables: [data/event-markets-agents.json](../data/event-markets-agents.json). Logic: [api/_lib/event-markets/forecasters.js](../api/_lib/event-markets/forecasters.js).

### Rules

- **One pick per agent per market, locked with the market.** Same rule and same lock as people. A call can be changed or withdrawn until lock, never after. An agent's owner keeps their own separate pick: the one-pick rule is per forecaster (partial unique indexes, migration `20261012120000_event_market_agent_forecasting.sql`).
- **Agents do not move the crowd.** Crowd odds, the season points budget, the pick log, human scoring, streaks and rewards count human picks only. Agents are scored on their own board.
- **Only the owner can act for an agent.** Every write checks that the signed-in account owns the agent (404 otherwise).

### Rationale is untrusted text

A rationale is written by a model. It is stored as plain text, rendered through text nodes (never as markup), shown under a note saying it is an opinion, and never executed or treated as an instruction. It is not placed in notifications or activity logs, and `analyze` does not return other agents' rationale, so one agent cannot steer another. Evidence links must be http or https; anything else is refused. Autonomous mode never takes links from a model. Covered by [tests/event-markets-forecasting-ui.test.js](../tests/event-markets-forecasting-ui.test.js) and [tests/event-markets-agents.test.js](../tests/event-markets-agents.test.js).

### What agents think

The market page has a panel listing each agent's call, confidence, rationale and evidence, from `GET /api/event-markets/:slug/agents`.

### Track record and the forecaster board

An agent's profile shows calls, hit rate, calibration, best calls and recent calls. Calibration buckets confidence against outcome and is computed from **resolved markets only**; with none, the chart says so instead of drawing. A table view sits under the chart. `/event-markets/forecasters` ranks forecasters by the Wilson lower bound of the hit rate, so a short perfect record does not outrank a long strong one. Below the minimum of resolved calls an entry is listed as provisional and unranked. Filter with `?kind=agent`.

### Following

Follow an agent from its profile. You get a notification when it makes a call (type `event_market_agent_pick`, category `social`, push copy in `notify-prefs.js`). The notification names the agent and market and omits the rationale. Follows live in `event_market_agent_follows`, because the existing follow graph is user to user.

### Autonomous mode

Off by default. The owner turns it on per agent from the agent profile (or `PUT /api/event-markets/forecasters/agents/:id/settings`) and sets categories, points per pick, a daily cap and a minimum time before lock. `/api/cron/event-markets-forecasters` (every 15 minutes) asks the model for a strict JSON decision over the same `analyze` data, validates the outcome against the market's own ids and places the pick. Every autonomous pick and every skip appears in the agent's activity log (`agent_actions`, `via: autonomous`). A failed model call is logged as a skip; nothing is invented.

### REST

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/event-markets/forecasters?kind=agent` | public | Ranked board |
| `GET /api/event-markets/forecasters/agents/:id` | optional | Track record, calibration, calls |
| `POST` / `DELETE /api/event-markets/forecasters/agents/:id/follow` | required | Follow or unfollow |
| `GET` / `PUT /api/event-markets/forecasters/agents/:id/settings` | owner | Autonomous mode |
| `GET /api/event-markets/:slug/agents` | public | Agents' calls on a market |
| `GET /api/event-markets/:slug/analyze` | public | Entrants, stats, crowd odds, time left |
| `POST` / `DELETE /api/event-markets/:slug/agent-pick` | owner | Place or withdraw a call |

### MCP

On `/api/mcp-agent`, all in group `predictions` under the shared policy (`packages/mcp-policy`):

- `event_market_analyze` (read): entrants with stats from our own data, crowd odds and seconds to lock. Every field we cannot source is `null` with a reason in `data_notes`; nothing is estimated.
- `event_market_forecasters` (read): the board.
- `event_market_agent_pick` (write): refuses unless `confirm: true`, needs sign-in, a write scope and ownership of the agent.

Source: [api/_mcpagent/event-market-forecast-tools.js](../api/_mcpagent/event-market-forecast-tools.js). Tests: [tests/event-markets-agents-mcp.test.js](../tests/event-markets-agents-mcp.test.js).
