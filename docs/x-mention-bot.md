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
| Known bot | `skip` / `known_bot`, unless it asks for a 3D model: then [answered on behalf of the human](#when-grok-or-bot-tags-us) | See below. |
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

## When @grok or @bot tags us

Grok Bot acts on X for its user, and @grok answers in threads, so one of them will tag us on a person's behalf ("@trythreews can you make a 3D version of this?"). Code: `api/_lib/x-mention-on-behalf.js`, called from `handleMention` when the guard reports `known_bot`.

1. **Whose request it is.** The human is the author of the conversation's root post (the post whose id is the mention's `conversation_id`). It comes from the parent post when the bot replied directly to the root, otherwise from `GET /2/tweets/:id`. The mention is stamped `args.on_behalf_of = { id, username, via }`. If the bot started the conversation itself, the root is gone, or the root author is another known bot, one of our accounts, blocklisted or under 24 hours old, the mention is skipped with `bot_no_human_root`, `bot_root_unresolved`, `bot_root_not_human`, `author_blocked` or `new_account`.
2. **What a bot may ask for.** Only a 3D model request (`make`), parsed by the same parser as any mention. Chat, `launch`, refused requests and anything else stay skipped as `known_bot`: a bot can never start a conversation, a launch or anything that moves funds.
3. **Whose limits apply.** The human's. `x_mention_events` counts a person's own mentions and mentions a bot wrote for them together (`countByPrincipal`), against `X_MENTION_REPLIES_PER_AUTHOR_HOUR` and `_DAY`. The bot account is never charged.
4. **One reply, machine-friendly.** To the bot's post, four lines: what we made, `Viewer: <link>`, `GLB: <link>`, and `Add three.ws to Grok Bot as an MCP connector: https://three.ws/api/mcp-grok`. A generation that fails or outlasts `X_BOT_MAKE_BUDGET_MS` (default 90 seconds) gets a reply with a prefilled `/forge?prompt=` link instead; a prompt the studio moderation refuses gets a fixed refusal with no echo. No handles, no hashtags, no dashes.
5. **Loop cap.** One reply per conversation to bot authors, ever (`bot_loop_cap`, counted from `args.on_behalf_of` on replied rows), and never an answer to a bot's reply to our reply (`bot_reply_to_own_reply`). The conversation depth cap above still applies.

Dry run applies as everywhere: the four-line reply is recorded on the row and nothing is posted until the owner flips the bot live. Tests with synthetic thread fixtures: `tests/x-mention-on-behalf.test.js`.

## Checking it

```bash
npx vitest run tests/x-mention-guard.test.js tests/x-budget.test.js
```
The kill switch tests assert zero calls to the reply brain and the X adapter.

## Late replies: make, avatar and image-to-3D follow-ups

A `make`, `avatar` or `image3d` mention whose 3D job outlives the bounded wait is recorded as `pending`. Every `x-mentions` tick then runs `runFollowUps()` (`api/_lib/x-mention-poll.js`), which calls `finishPendingMakes()`, `finishPendingAvatars()` and `finishPendingImage3d()` (`api/_lib/x-mention-image3d.js`, see [x-mention-image3d.md](x-mention-image3d.md)):

- **Gated like any reply.** The kill switch skips all three, and a closed read/post budget gate skips all three. The report carries `followUps: { skipped: 'kill_switch' | 'budget' }`.
- **Isolated.** Each finisher runs in its own catch; one throwing reports `{ error }` under `makeFollowUp`, `avatarFollowUp` or `image3dFollowUp` and the others still run.
- **Delivered through the X adapter.** `api/_lib/x-mention-deliver.js` builds the `deliver` the finishers use on `createXAdapter`. A dry row (`dry_run = true`, the default) is only recorded on the `x_mention_events` row and nothing is posted. A live row is posted by the adapter only when `X_MENTION_BOT_LIVE=1` and a token resolver is supplied (`getAccessToken(row)`); each real post counts against the post budget. With no resolver the adapter stays in dry run, so rows are no longer held as `paused` for lack of a deliver.

The `image3d` intent is routed to `handleImage3d()` in `handleMention` (dry run, same budget and per-author limits as any reply); only `make` and `launch` still answer with help (`handler_not_built`).

Going live stays the separate owner step.
