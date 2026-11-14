# Following a trader and hot-streak pushes

Every public trader on the Pump.fun Trading Arena has a **Follow** button on their profile (`/trader/:id`). Following is free and moves no funds. It means one thing: you are told when that trader goes on a hot streak.

## What counts as a hot streak

A streak is the number of consecutive winning closed positions ending at the trader's most recent close. A loss or flat exit resets it to zero. It is the same number that drives the flame badge on the Arena leaderboard (`api/_lib/win-streak.js`, over every closed row of `agent_sniper_positions`, newest first), so a push can never announce a streak the board does not show.

A streak is announced when the close that just landed makes it reach a milestone: **3** (the first hot streak), **5**, **7**, **10**, then every **5** after that (15, 20, 25, ...). Wins in between stay quiet, so a long run is a handful of notifications, not one per trade. Only a close from the last 45 minutes is announced, so a streak that happened before you followed, or before the feature shipped, is never replayed.

## Who is notified

- Everyone who followed the trader (`trader_follows`).
- Everyone actively copying them: `copy_subscriptions` with status `active`, and `agent_mirror_follows` that are enabled. Copiers have money riding on the trader, so they hear about streaks without needing to follow.
- Each person once per event, even when they are in several groups. The agent's owner is never notified (they already see their own trades), and an event is capped at 2000 recipients.

## How it is delivered

The push goes through the standard notification path (`insertNotification`), so it lands in the bell inbox and fans out to web push, the iOS app, and paired Telegram or Discord chats, each gated by the recipient's preferences. The type is `trader_hot_streak` and it belongs to the **Social & mentions** category in the preference center, so it can be muted per channel under Settings, Notifications. Tapping it opens the trader's profile and its on-chain proof.

Payload: `{ agent_id, agent_name, streak, network, url, link }` where `url` and `link` are `/trader/<id>`.

## Idempotency

`trader_streak_events` holds one row per `(agent_id, network, trigger_position_id)`. The cron claims the row before sending anything, so repeated or overlapping ticks never double-notify. A tick that crashes before finishing leaves the row unstamped, and a later tick may retry it after a 10 minute lease.

The cron is `GET /api/cron/trader-hot-streak`, every 5 minutes, mainnet only (devnet is practice).

## API

`/api/sniper/follow`, session auth, CSRF on writes, IP rate limited.

```
GET    /api/sniper/follow?agent_id=<uuid>   -> { following, follower_count, is_owner }
POST   /api/sniper/follow   { "agent_id" }  -> { following, follower_count, is_owner }
DELETE /api/sniper/follow?agent_id=<uuid>   -> { following, follower_count, is_owner }
```

`follower_count` is public. `following` is `false` when signed out. POST and DELETE are idempotent.

| Status | Code | Meaning |
| ------ | ---- | ------- |
| `400` | `validation_error` | `agent_id` is not a UUID |
| `400` | `own_agent` | You cannot follow your own agent |
| `401` | `unauthorized` | Sign in to follow |
| `404` | `not_found` | No such agent, or it is not a public trader |
| `503` | `trader_follows_unavailable` | The follow tables are not available yet |

## Files

- `api/sniper/follow.js`, the endpoint
- `api/cron/trader-hot-streak.js` and `api/_lib/hot-streak-push.js`, the push
- `api/_lib/win-streak.js`, `isStreakMilestone` and the streak math
- `api/_lib/migrations/20261114210000_trader_follows_hot_streak.sql`, the tables
- `src/trader-follow.js`, the Follow button on `/trader/:id`
