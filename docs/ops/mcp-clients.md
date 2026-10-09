# MCP client analytics

Which AI clients use the hosted three.ws MCP servers: Grok Bot, Claude,
ChatGPT, Cursor or something else. Every MCP `initialize` names its client in
`clientInfo.name` and `clientInfo.version`. This board records that, joins each
later `tools/call` to it, and shows the result to platform admins.

Code: [api/_lib/mcp-clients.js](../../api/_lib/mcp-clients.js). Endpoint:
[api/ops/mcp-clients.js](../../api/ops/mcp-clients.js). Page:
[/mcp-clients](../../pages/mcp-clients.html) (admin session, `noindex`, not in
`data/pages.json`). Tests: [tests/mcp-clients.test.js](../../tests/mcp-clients.test.js).

## How it records

The MCP servers are stateless, so a tool call carries nothing that says who
made it. On `initialize` each server therefore issues an `Mcp-Session-Id`
(`mcs_<uuid>`, `grk_<uuid>` on the Grok surface). Conforming clients echo it on
every later request, and that header is the join key.

- `initialize`: one session row plus an increment on the daily aggregate
  (day, surface, normalized client name, version, auth kind).
- `tools/call`: an increment on the session's call count and on the daily
  per-tool aggregate. Calls to a tool that does not exist count as `unknown_tool`.
- Client names are trimmed, lowercased, stripped of unusual characters and capped
  at 64 characters. Each process admits at most 300 distinct clients and 200
  distinct tools a day, folding the rest into `other`, so a hostile caller cannot
  grow the tables.
- Auth kind is `anonymous`, `install` (studio install token), `key` (API key),
  `oauth` or `x402`.
- Writes happen after the response is sent, buffered and flushed in batches (250 ms
  or 100 events). A failed write is logged (`mcp-clients flush_failed`) and
  dropped; it never reaches the caller. Request bodies, arguments, IPs and
  headers are never stored.

Surfaces tracked: `mcp`, `mcp-3d`, `mcp-agent`, `mcp-bazaar`, `pump-fun-mcp` and
the studio handler (`full`, `chatgpt`, `grok`).

## Reading it

`GET /api/ops/mcp-clients?days=30` (1 to 365), admin only: 401 without a
session, 403 for a signed-in non-admin, 503 `migration_pending` before the
migration is applied. It returns totals, a per-client list (sessions, calls,
share of calls, versions, surfaces, auth kinds, top tools) and a zero-filled
daily series.

```bash
curl -s -H "Cookie: $SESSION" "https://three.ws/api/ops/mcp-clients?days=7" | jq '.clients[] | {client, sessions, calls}'
```

`totals.unattributed_share` is the fraction of calls whose client is `unknown`
because the caller never echoed the session id. When it is high, the client
list is a floor, not a count.

To see a local run, serve with `DATABASE_URL` loaded
(`node --env-file=.env.local server/index.mjs`) and run
`npm run probe:mcp-clients -- --base http://localhost:3000`. The probe
identifies itself as client `probe`.

## Retention

Tables from migration `20261009172000_mcp_client_analytics.sql`:
`mcp_client_sessions` (raw, per session), `mcp_client_daily` and
`mcp_client_tool_daily` (aggregates, kept). The `db-retention` cron deletes raw
session rows after 30 days; see [db-retention.md](db-retention.md).
