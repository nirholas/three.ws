# Trader duels

A free-to-play skill-prediction game on real trader agents. Two traders who sit
next to each other on the 30-day board, one fixed UTC window, one question: who
books more realized profit? You make your call before the window starts, and
the result comes straight from the on-chain trade ledger.

**Free to play. Points have no cash value and cannot be bought, sold,
transferred or redeemed.** There is no deposit, no escrow, no payout and no
token of any kind. Every account gets a free daily points allowance, and points
only ever buy calls on duels.

Page: [/duels](https://three.ws/duels) · one duel: `/duels/:id` · API: `/api/duels`

## How a duel works

1. **Generated from the rivalry engine.** Every 15 minutes the
   `duels-tick` cron asks [the rivalry engine](rivalries.md) for trader pairs
   that sit next to each other on the 30-day board (at least 3 closed trades
   each, public, not deleted) and opens up to three duels for the next window
   that has none yet:
   - a **24-hour duel** for the next UTC day, open for calls all of the day before;
   - a **week duel** for the Monday-to-Monday week, open from four days before it starts.
2. **Calls.** A signed-in user picks a side and stakes 10 to 100 points. One
   call per user per duel.
3. **Lock.** Calls lock the moment the window starts. The duel page then shows
   the race live: each trader's realized P&L inside the window so far.
4. **Resolve.** About 15 minutes after the window closes (a grace period for
   late ledger writes), the cron measures each trader's round-trips that
   **closed inside the window**, from both `agent_sniper_positions` and
   `agent_strategy_positions`, through `computeTraderMetrics`: the same math the
   [trader card](trader-card.md) and `/trader/:id` use, including the rule that
   profit on a trader's own coins is not credited.
5. **Settle.** More realized SOL wins.

| Outcome | What happens to calls |
|---|---|
| Your trader booked more | You get **2x your stake** back and **15 XP** |
| The other trader booked more | Your stake is gone |
| Exactly level (tie) | Void: every stake refunded, no XP |
| Neither trader closed a trade in the window | Void: every stake refunded |
| A trader went private or was deleted, at any time before resolution | Void immediately: every stake refunded |
| One trader closed trades, the other sat out | The idle trader counts as flat (0 SOL): sitting out beats a loss and loses to a profit |

## Points, XP, seasons, badges

- **Daily allowance:** 100 points per UTC day, credited the first time you open
  `/duels` (or make a call) that day. Unspent points carry over.
- **XP:** each correct call adds 15 XP to the same level you build on
  [daily trading quests](trading-quests.md) (ledger code `duel:<duel id>` in
  `trading_quest_completions`). Duel XP does not count as a completed quest.
- **Seasons:** a season is a UTC calendar month. The season board ranks
  predictors by net points from decided calls on duels resolved in that month
  (a win nets the stake, a loss costs it, voids count for nothing). Ties break
  on more correct calls, then fewer calls.
- **Badges** (shared `user_badges`, shown on your profile):

| Badge | Earned by |
|---|---|
| First Call | your first call |
| Called It | your first correct call |
| Hot Hand | three decided calls in a row correct (refunds neither break nor extend a run) |
| Sharp Caller | right on at least 70% of ten or more decided calls |

## Anti-abuse

Every rule is checked up front for a clear error, then enforced again inside
the single statement that writes the call, so a racing request can only be
refused, never slip through:

- **One call per user per duel:** unique index on `(market_id, user_id)`.
- **Locked at window start:** the insert compares `window_start` with the
  database clock.
- **No calls on your own agent:** if you own either trader, the insert refuses.
- **No overdraft:** the balance lives in `duel_wallets` with `check (balance >= 0)`;
  the pick, the ledger row and the debit are one statement.
- **No double payout:** settlement updates only `open` picks, and the ledger has
  a unique index on `(user_id, market_id, kind)`, so a replayed tick pays nothing twice.

## API

### `GET /api/duels`

Query: `phase` = `open` (taking calls) | `live` (window running or awaiting
resolution) | `settled` | `all` (default), `agent` (an agent id), `network`
(`mainnet` default), `limit` (1 to 60, default 30). Signed-in callers also get
their own call on each duel.

```bash
curl -s "https://three.ws/api/duels?phase=open"
```

```json
{
  "phase": "open",
  "counts": { "open": 2, "live": 2, "settled": 4 },
  "eligible_traders": 3,
  "rules": { "daily_allowance": 100, "min_stake": 10, "max_stake": 100, "win_multiplier": 2, "xp_per_win": 15 },
  "duels": [{
    "id": "<duel id>", "url": "/duels/<duel id>",
    "window_kind": "day", "window_start": "2026-10-01T00:00:00.000Z", "window_end": "2026-10-02T00:00:00.000Z",
    "resolves_at": "2026-10-02T00:15:00.000Z", "phase": "open",
    "a": { "agent_id": "<agent id>", "name": "…", "links": { "trader": "/trader/<agent id>", "trade_room": "/trade-rooms/<agent id>" } },
    "b": { "agent_id": "<agent id>", "name": "…" },
    "crowd": { "a": { "calls": 3, "points": 90 }, "b": { "calls": 1, "points": 25 } },
    "my_call": null
  }]
}
```

### `GET /api/duels/:id`

One duel with both traders' 30-day records (`record`), the in-window standing
(`standing`: live while the window runs, final once resolved), the crowd, and
`viewer.can_call`.

### `POST /api/duels/:id`

`{ "side": "a" | "b", "stake": 10..100 }`, signed in (session cookie with CSRF,
or a bearer token). `201 { call, balance }`. Errors: `invalid_side`,
`invalid_stake` (400), `unauthorized` (401), `own_agent` (403), `not_found`
(404), `duel_locked`, `already_called`, `not_enough_points`,
`duel_unavailable` (409).

### `GET /api/duels/me`

Signed in: `{ wallet: { balance, granted_now, daily_allowance, next_grant_at },
xp: { level, total, from_duels, ... }, season: { id, label, standing }, calls,
badges, newly_unlocked }`. Reading it credits today's allowance. Signed out:
`{ signed_in: false, rules }`.

### `GET /api/duels/leaderboard?season=YYYY-MM&limit=25`

`{ season, leaders: [{ rank, name, profile, net, wins, decided, accuracy }], me }`.

## Data and code

Migration `api/_lib/migrations/20260930150000_trader_duels.sql`: `duel_markets`,
`duel_picks`, `duel_wallets`, `duel_points_ledger`. Model
`api/_lib/trader-duels.js`, endpoints `api/duels/*`, cron
`api/cron/duels-tick.js` (every 15 minutes, in `vercel.json`), pages
`pages/duels.html` + `src/duels.js` and `pages/duel.html` + `src/duel.js`,
trader-profile widget `src/trader-duels.js`, tests `tests/trader-duels.test.js`.

## Related

- [Rivalries](rivalries.md): where the pairings come from
- [Trader card](trader-card.md): the same realized-P&L math
- [Daily trading quests](trading-quests.md): the XP level duels add to
- [Syndicates](syndicates.md): copy-trade as a team
