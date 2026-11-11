---
name: three-ws-discovery
description: Read live three.ws discovery data (trending agents, trending coins, the $THREE holder leaderboard and tiers, the activity ticker) through the activity-mcp tools. Use when asked what is hot on three.ws, where a wallet ranks, or what just happened on the platform.
---

# three.ws live discovery

The plugin starts `@three-ws/activity-mcp` over stdio (`npx -y @three-ws/activity-mcp`). It is a read-only wrapper over the public three.ws API. It needs no key, signer or payment.

## Environment (both optional)

- `THREE_WS_BASE`: API origin, default `https://three.ws`. Change it only to target a self-hosted or preview deployment.
- `THREE_WS_TIMEOUT_MS`: per-request timeout in milliseconds, default `20000`. Must be a positive number.

## Tools

| Tool | Arguments | Backing endpoint |
| --- | --- | --- |
| `get_trending_agents` | `window` (`24h`, `7d`, `all`; default `24h`), `sort` (`activity` or `trust`), `limit` (1-20, default 10) | `GET /api/trending` |
| `get_trending_coins` | `limit` (1-20, default 10) | `GET /api/trending` |
| `get_holder_leaderboard` | `limit` (1-100, default 50), `offset` (default 0), `wallet` (base58, optional) | `GET /api/leaderboard` |
| `get_tier_info` | none | `GET /api/leaderboard` (tier ladder) |
| `get_feed_events` | `limit` (1-100, default 30) | `GET /api/feed` |

Every tool returns JSON text with `ok: true` on success. A failure returns `ok: false`, an `error` code and a `message`, with the result flagged as an error.

## How to use them

1. For "what is trending", call `get_trending_agents` (ranked by real chat activity) or `get_trending_coins` (ranked by the Oracle conviction score, 0-100). Coin results are discovery data, not financial advice. Say so when you summarize them.
2. For "where does this wallet rank", call `get_holder_leaderboard` with `wallet` set. The `you` field reports that wallet's rank, amount, share of supply and tier even when it is outside the returned page. Page through the board with `limit` and `offset`.
3. For "what does tier X mean" or "how far to the next tier", call `get_tier_info`. Each tier is `{ id, label, min, accent }`, where `min` is the whole-token $THREE balance required.
4. For recent platform events, call `get_feed_events`. Events carry `type`, `ts` (epoch milliseconds), an already-public `actor` label and type-specific fields.

## Worked example

Request: "Which agents are hottest this week, weighted toward trusted wallets?"

Call `get_trending_agents` with `{ "window": "7d", "sort": "trust", "limit": 5 }`. Report each row's `name`, `window_chats`, `chat_count` and `agent_url`, and the reputation card `{ score, tier }` when present.

## Notes

- Data moves between calls. Do not cache rankings across a conversation.
- Nothing here signs or spends. If the user wants to act on a result, that is a separate tool and needs their explicit confirmation.
