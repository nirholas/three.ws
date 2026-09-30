# Daily trading quests

Five small trading goals a day that reset at 00:00 UTC. Every quest is scored
from proof, never from a click, and rewards are XP, levels and badges.

Page: [/quests](https://three.ws/quests) · API: `/api/quests`

## The quests

| Quest | Target | XP | Counted from |
|---|---|---|---|
| Make 3 trades | 3 | 30 | Trades whose signature was verified on-chain by buy-confirm / sell-confirm and signed by a Solana wallet **linked to your account**, plus confirmed Co-Pilot trades on an agent you own |
| Fork a verified trade | 1 | 25 | One of those verified trades opened from a Fork button (`src/fork-trade.js`) |
| Ghost-copy a new agent | 1 | 15 | The first time you [ghost-copy](ghost-copy.md) a leader you never replayed before |
| Act on a copy intent | 1 | 25 | A copy intent on [/dashboard/copy](https://three.ws/dashboard/copy) you marked copied today |
| Your agent closes a winner | 1 | 20 | An agent you own closes a **live** trade in profit (paper trades do not count) |

Clear any **3** in one UTC day for a **daily clear** (+50 XP). Consecutive days
with a clear make your clear streak.

### Why "linked wallet"

Trade signatures are public. Without the link, anyone could report someone
else's verified trade as their own. A trade counts only when its signing wallet
is one of your account's Solana wallets (`user_wallets`, or the wallet you
signed in with), and each signature can be claimed once.

## Levels and badges

Reaching level `L` takes `50 x L x (L - 1)` XP in total: 100 XP for level 2,
300 for level 3, 600 for level 4. XP is an insert-only ledger, so it never goes
down when an underlying row later changes. Correct calls on
[trader duels](trader-duels.md) add 15 XP each to the same ledger (code
`duel:<duel id>`); they raise your level but do not count as completed quests.

| Badge | Earned by |
|---|---|
| First Quest | completing any quest |
| Daily Clear | your first daily clear |
| Quest Streak 7 | seven daily clears in a row |

Badges live in the shared `user_badges` table with the rest of the platform's
badges, so they show on your profile.

## When progress is awarded

Progress is computed and awarded when you (or the page) read your quests, for
today **and yesterday**. The proof tables are durable, so a quest finished at
23:59 UTC still counts when you look the next morning.

## $THREE rewards (disarmed)

A daily clear can also pay $THREE to your linked Solana wallet. Paying it moves
$THREE out of a platform wallet, which is an owner decision, so the payout
ships **disarmed**. With the switch off, `POST /api/quests/claim` answers
`409 rewards_disarmed` before it reads or writes a row, loads a key or opens an
RPC connection, and the page does not show a claim button at all.

The owner arms it with all three of these on the Cloud Run service
(`gcloud run services update three-ws-api --update-env-vars ...`, never
`--set-env-vars`):

| Variable | Meaning |
|---|---|
| `TRADING_QUEST_THREE_REWARDS` | `on` to arm. Default off. |
| `TRADING_QUEST_THREE_REWARD_AMOUNT` | whole $THREE paid per daily clear, more than 0 |
| `TRADING_QUEST_THREE_REWARD_SECRET_KEY_B64` | base64 64-byte secret of the funded payout wallet |
| `TRADING_QUEST_THREE_REWARD_DAILY_BUDGET` | optional: whole $THREE paid across all users per UTC day (default 20 x the amount) |

A half-configured deploy stays disarmed. When armed: one reward per user per
UTC day, only for a day the user cleared, only for today or yesterday, only to a
linked wallet, bounded by the daily budget. The ledger row
(`trading_quest_three_rewards`) is claimed before the Token-2022 transfer and
marked `sent` or `failed` after, so a double click never pays twice and a
failed transfer can be retried. Code: `api/_lib/quest-rewards.js`, tests:
`tests/quest-rewards.test.js`.

## API

### `GET /api/quests`

Signed out: `{ signed_in: false, day, resets_at, quests, daily_clear, three_rewards }`
with no progress. Signed in:

```json
{
  "signed_in": true,
  "day": "2026-09-29",
  "resets_at": "2026-09-30T00:00:00.000Z",
  "quests": [{ "code": "trades_3", "title": "Make 3 trades", "target": 3, "progress": 1, "done": false, "xp": 30, "cta": { "href": "/trades" } }],
  "daily_clear": { "need": 3, "xp": 50, "done_count": 1, "cleared": false },
  "xp": { "total": 40, "level": 1, "into_level": 40, "level_span": 100, "next_level_at": 100 },
  "clear_streak": { "current": 0, "longest": 0 },
  "badges": [],
  "newly_completed": [{ "day": "2026-09-29", "code": "ghost_new" }],
  "three_rewards": { "armed": false }
}
```

```bash
curl -s https://three.ws/api/quests
```

### `POST /api/quests/event`

`{ "kind": "ghost_copy", "leader_agent_id": "<uuid>", "network": "mainnet" }`,
signed in. The ghost-copy page sends this after a finished replay, because the
replay endpoint is public and cached and never learns who ran it. The leader
must be a public agent with closed trades. It also completes step 2 of the
first-copy path. Returns `{ recorded: true, new_agent }`.

### `POST /api/quests/claim`

`{ "day": "2026-09-29" }`, signed in. Disarmed by default (`409
rewards_disarmed`). When armed: `200 { status: "sent", tx_signature,
amount_three }`, or `not_cleared`, `no_wallet`, `in_flight`,
`budget_exhausted` (409), `invalid_day` (400), `payout_failed` (502).

## Data

Migration `api/_lib/migrations/20260929121000_trading_quests.sql`:
`trading_quest_events` (verified trades with their fork origin, and first
ghost-copies per leader), `trading_quest_completions` (the XP ledger) and
`trading_quest_three_rewards` (empty unless armed). Code:
`api/_lib/trading-quests.js`, `api/quests/*`, `src/quests.js`.

## Related

- [Syndicates](syndicates.md): copy-trade as a team
- [Trader duels](trader-duels.md): free-to-play calls on head-to-head traders, more XP
- [Fork a trade](fork-trade.md) and [Ghost-copy](ghost-copy.md): two of the quests
- [Copy trading](copy-trading.md): where copy intents come from
