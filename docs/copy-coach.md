# Copy Coach: your first copy trade, the careful way

The Copy Coach takes someone who has never copied a trader from zero to one
small, safe first action, and it refuses to oversell on the way. Every number
is real and links to where it came from, the first two steps need no account
and no wallet, and the only real-money step is hard-capped by the server and
still spends nothing until the user signs a trade from their own wallet.

Page: [/copy-coach](https://three.ws/copy-coach) (in the nav next to Copy
Trading, and linked from [/ghost-copy](https://three.ws/ghost-copy)) ·
`GET /api/copy/coach` · `POST /api/copy/coach`
Model: `api/_lib/copy-coach.js` · Caps: `STARTER_CAPS` in `api/_lib/copy-engine.js` ·
Page: `pages/copy-coach.html`, `src/copy-coach.js`, `src/copy-coach.css`

## The four steps, and why each one is safe

| Step | What the user sees | Why it is safe |
|---|---|---|
| 1. See a real win | The most recent public trade that closed up 25% or more in the last 14 days, with its signed buy and sell transactions on Solscan and the "why it traded" [receipt](./trade-receipts.md), **right next to the same agent's full 30-day record**. When that record is negative the page says so in plain words: the win is real, and it still came from an agent that lost money. | Reading only. |
| 2. Ghost-copy | Leaders with closed trades in the last 30 days, each marked copyable or not against the platform's real bar (and, if not, what is missing). One click replays the chosen leader with fake money through [ghost-copy](./ghost-copy.md): fake balance, realized result, wins and losses, worst drawdown, and the equity curve. A losing replay gets a red verdict: the coach would not copy this leader with real money yet. | Fake money. No wallet, no signature, no account. |
| 3. One tiny real copy | A starter copy of the chosen leader: a fixed size per trade, a daily cap, a limit on open copies, an automatic pause if the leader draws down, and only coins that pass the safety check. A confirmation card restates every term, including the performance fee, before anything is saved. Confirm stays disabled until the user ticks "I understand copy trading can lose money", and a second box appears when their own ghost run of that leader lost. | Non-custodial, server-enforced caps, and nothing is spent at confirmation: each copied entry arrives as an intent in [/dashboard/copy](https://three.ws/dashboard/copy) that only trades if the user signs it. |
| 4. What comes next | Where copies show up, the leader's full record, other ghost runs, full copy with the user's own caps, and the [Sentiment Scout](./sentiment-scout.md). The advice is to stay at starter size until the record, not one good day, earns more. | Links only. |

Progress (current step, completed steps, chosen leader) is remembered in the
browser and carried in the URL (`?step=ghost_copy&leader=<id>`), so a user can
leave, sign in, and land back where they were.

## Starter caps

Enforced by `normalizeSubscriptionInput` in `api/_lib/copy-engine.js` whenever
a subscription request carries `starter: true`, so no client, slider or script
can go past them:

| Limit | Starter cap |
|---|---|
| Size per copied trade (fixed sizing only) | 0.05 SOL |
| Daily budget | 0.2 SOL |
| Open copies at once | 2 |
| Auto-pause on leader drawdown | required, at 25% or tighter |
| Safety check on every copied coin | required |
| Risk acknowledgement | `risk_ack: true` required |

A request past any cap is refused with a plain reason, for example
`{"error":"invalid_config","error_description":"a starter copy caps each trade at 0.05 SOL"}`,
and nothing is written. The page creates the copy with the existing
`POST /api/copy/subscriptions` (session plus CSRF), so the leader still has to
clear the copyable bar and a user still cannot copy an agent they own.

## Ask the coach

The side panel answers questions in one to three sentences through the
platform's LLM failover chain (`api/_lib/llm.js`), with suggested questions for
each step. Answers are grounded in a fact sheet the server builds from real
rows: the starter caps, custody, the verified win and its agent's record, the
chosen leader, and the user's ghost replay, **recomputed server side** so the
coach never repeats numbers the browser sent. No answer is trusted as written.
`validateCoachReply()` refuses one that:

- promises returns ("you will make", "can't lose", "risk-free profit"),
- contains a number the fact sheet does not hold,
- names a coin other than one in the facts or $THREE, or
- links off-platform.

A refused answer, or a chain that is down, is replaced by the deterministic
guide, which answers by intent (risk, guarantees, custody, fees, caps,
stopping, the next step) from the same caps. Asked for a guarantee, the coach
always says there are none and points to the verified record and skin in the
game as the honest signal. Each answer is labeled with where it came from.

## The API

```bash
# The page's data: the verified win and its agent's record, the leaders, the caps
curl "https://three.ws/api/copy/coach"

# Ask a question, grounded in a leader's 30-day ghost replay with 1 fake SOL
curl -X POST "https://three.ws/api/copy/coach" \
  -H 'content-type: application/json' \
  -d '{"message":"Can I lose money?","step":"ghost_copy","leader_id":"<agent uuid>","window":"30d","budget_sol":1}'
```

`GET` takes an optional `?network=mainnet|devnet` (default `mainnet`) and returns
`{ network, win, leaders[], starter_caps, eligibility_bar, generated_at }`.
`win` is null when no public agent closed a signed 25%+ win in the last 14
days, and the page says so rather than reaching further back. Each leader
carries `copyable` and, when not, `unmet` in words.

`POST` takes `message` (required, up to 500 characters), `history` (the last
turns as `{ role: 'user'|'coach', text }`), `step` (`see_a_win`, `ghost_copy`,
`starter_copy`, `full_copy`), `leader_id`, `window` (`24h`, `7d`, `30d`, `all`;
default `30d`), `budget_sol` (default 1) and `network`, and
returns `{ reply, source: 'llm'|'guide', model, facts_used }`.

Both are public and need no account. `GET` shares the public IP limit;
`POST` has its own bucket (30 questions per 10 minutes per IP). Errors use the
platform shape `{ error, error_description }`: `invalid_json`, `invalid_message`,
`message_too_long`, `invalid_leader`, `invalid_network`.

## Related

- [Ghost-copy](./ghost-copy.md): the replay step 2 runs.
- [Trade receipts](./trade-receipts.md): the "why it traded" behind the win.
- [Sentiment Scout](./sentiment-scout.md): momentum with receipts.
- [Trading Copilot](./trading-copilot.md): the confirm-before-execute trade
  cards for an agent's own wallet.
