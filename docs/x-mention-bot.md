# X mention bot: safety rules

The bot reads mentions of our X accounts (`/api/cron/x-mentions`, every two minutes), decides, and answers with one public reply. It runs in dry run: replies are written to `x_mention_events` and nothing is posted until the owner flips it live. Every decision is stored on the mention's row with a reason, so the audit trail is one query:

```sql
select decision, reason, count(*) from x_mention_events group by 1, 2 order by 3 desc;
```

Text from X is untrusted data. None of the rules below read what a mention says; they key off ids, timestamps and our own records. Code: `api/_lib/x-mention-guard.js`, `api/_lib/x-mention-known-bots.js`, wired in `api/_lib/x-mention-poll.js`.

## Rules, in the order they run

| Rule | Decision / reason | How to change it |
|---|---|---|
| Kill switch | `paused` / `kill_switch` | Set env `X_MENTION_BOT_PAUSED=1`, or insert the `app_settings` row `x_mention_bot_paused` = `{"paused": true}` (takes effect on the next tick, no deploy). A failed settings read also pauses. Mentions are still recorded and the cursor still advances, so unpausing never answers the backlog. |
| Parser ignores (retweets, our own posts) | `skip` / parser reason | `api/_lib/x-mention-intents.js` |
| Our own account | `skip` / `own_account` | The polled account's id and handle, the company id, plus env `X_MENTION_OWN_USER_IDS` (comma separated ids). |
| Blocklist | `skip` / `author_blocked` | `app_settings` row `x_mention_blocklist` = `{"ids": ["<author id>", ...]}`. |
| Known bot quoting our post without addressing us | `skip` / `bot_quote_of_own_post` | Automatic for any known bot. |
| Known bot | `skip` / `known_bot` | See below. |
| Author account under 24 hours old | `skip` / `new_account` | `MIN_AUTHOR_AGE_SECONDS` in the guard. Skipped only when X returns `created_at`. |
| One reply per conversation per hour | `skip` / `conversation_hourly` | `CONVERSATION_WINDOW_SECONDS` in the guard. |
| Depth cap: never a third reply in a conversation | `skip` / `conversation_depth` | `CONVERSATION_MAX_REPLIES` in the guard. |
| Per-author allowance | `rate_limited` | env `X_MENTION_REPLIES_PER_AUTHOR_HOUR` (3), `X_MENTION_REPLIES_PER_AUTHOR_DAY` (10). |
| X API budget | `budget` / `degraded:<intent>`, `daily_post_cap`, `monthly_post_cap`, `rate_limit_backoff`, `budget_unreadable` | See "The X budget" below. |

Replies counted for the conversation rules include dry-run replies, so dry run behaves exactly as live will.

## Known bots

`KNOWN_BOT_USERNAMES` in `x-mention-known-bots.js` is the source of truth (`grok`, `bot`). Add more without a deploy through env `X_MENTION_KNOWN_BOTS` (comma separated usernames). On the first mention batch of each day the poller resolves the names to ids with `GET /2/users/by` and caches them in `app_settings` key `x_mention_known_bots`; a refused lookup (tier, rate window, auth) keeps the old ids, is retried the next day, and lists the names under `unresolved`. A known bot is matched by cached id or by username, so the list works before any lookup succeeds and survives a rename.

## The X budget

X reads and posts are metered, and a viral thread can send thousands of mentions in an hour. `api/_lib/x-budget.js` counts every read and every reply in `app_settings` (`x_budget_day_YYYY-MM-DD`, `x_budget_month_YYYY-MM`, UTC) and the bot degrades in a fixed order instead of burning the month in a day or going dark mid-conversation. Replies count the moment they are decided, dry run included, so the numbers are honest before going live.

| Cap | Env | Default | Reasoning |
|---|---|---|---|
| Replies per month | `X_MENTION_MONTHLY_POST_CAP` | 1500 | About 50 a day. Low enough that a mispriced tier cannot run away, high enough for real conversations. |
| Replies per day | `X_MENTION_DAILY_POST_CAP` | 80 | Monthly cap spread over 30 days with headroom, so one viral day cannot spend the month. |
| Posts read per month | `X_MENTION_MONTHLY_READ_CAP` | 15000 | X bills per post read. The poller only reads mentions newer than its cursor, so this is about ten times the reply cap (most mentions are skipped by the parser and the safety rules). |

These are conservative placeholders until order 926 records the real allowances of the X tier; raise them with env, no deploy of code needed.

The ladder uses the largest used fraction of any cap (the "level"). Dropped intents are answered with nothing (a reply costs a post) and recorded as `budget` with the reason:

| Level | Dropped |
|---|---|
| 70% | `chat` |
| 80% | `avatar` |
| 90% | `image3d` |
| 100% | `make`, `launch` and `help` (a cap is a hard stop; `make` and `help` go last) |

X's own headers are honored too. After every read, `x-rate-limit-remaining: 0` backs the bot off until `x-rate-limit-reset`, and `x-app-limit-24hour-remaining: 0` until `x-app-limit-24hour-reset`; a 429 with neither backs off 15 minutes. While a backoff is active the reader does not call X and no reply is composed (`rate_limit_backoff`); the cursor stays put, so mentions are read after the window, never lost. A budget that cannot be read fails closed (`budget_unreadable`). When the read cap is reached the poll tick reports `status: budget`.

`getBudgetUsage()` returns caps, usage, remaining, level, dropped intents and any backoff; the status endpoint (order 064) serves it.

## Checking it

```bash
npx vitest run tests/x-mention-guard.test.js tests/x-budget.test.js
```
The kill switch tests assert zero calls to the reply brain and the X adapter.
