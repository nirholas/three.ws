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

Replies counted for the conversation rules include dry-run replies, so dry run behaves exactly as live will.

## Known bots

`KNOWN_BOT_USERNAMES` in `x-mention-known-bots.js` is the source of truth (`grok`, `bot`). Add more without a deploy through env `X_MENTION_KNOWN_BOTS` (comma separated usernames). On the first mention batch of each day the poller resolves the names to ids with `GET /2/users/by` and caches them in `app_settings` key `x_mention_known_bots`; a refused lookup (tier, rate window, auth) keeps the old ids, is retried the next day, and lists the names under `unresolved`. A known bot is matched by cached id or by username, so the list works before any lookup succeeds and survives a rename.

## Checking it

```bash
npx vitest run tests/x-mention-guard.test.js
```
The kill switch tests assert zero calls to the reply brain and the X adapter.
