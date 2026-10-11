# MCP clients board

Which AI clients use the hosted three.ws MCP servers: Grok Bot, Claude,
ChatGPT, Cursor or something else. Every MCP `initialize` names its client in
`clientInfo.name` and `clientInfo.version`. This board records that, joins each
later `tools/call` to it, and shows the result to platform admins: how many
sessions each client opens, how many tools it calls, which tools, and how it
authenticated. It answers whether the Grok Bot work is landing and which
client to optimize next.

Code: [api/_lib/mcp-clients.js](../../api/_lib/mcp-clients.js). Endpoint:
[api/ops/mcp-clients.js](../../api/ops/mcp-clients.js). Page:
[/mcp-clients](../../pages/mcp-clients.html) (admin session, `noindex`, not in
`data/pages.json`). Tests: [tests/mcp-clients.test.js](../../tests/mcp-clients.test.js).

Both the page and the endpoint need a signed-in platform admin
(`requireAdmin`): no session answers `401`, a signed-in account that is not an
admin answers `403`.

## How it records

The MCP servers are stateless, so a tool call carries nothing that says who
made it. On `initialize` each server therefore issues an `Mcp-Session-Id`
(`mcs_<uuid>`, or `grk_<uuid>` on the Grok surface, whose per-caller rate caps
key on it). Conforming clients echo it on every later request, and that header
is the join key. The id holds no server state: requests are still served
statelessly, and a `DELETE` carrying one of these ids answers `204` (any other
id still answers the transport's `404`, "start a new session").

- `initialize`: one `mcp_client_sessions` row plus an increment on the daily
  aggregate (day, surface, normalized client name, version, auth kind).
- `tools/call`: an increment on the session's call count and on the daily
  per-tool aggregate. Calls to a tool that does not exist count as `unknown_tool`.
- Client names are trimmed, lowercased, stripped of unusual characters and capped
  at 64 characters. Each process admits at most 300 distinct clients and 200
  distinct tools a day, folding the rest into `other`, so a hostile caller cannot
  grow the tables without bound.
- Auth kind is `anonymous`, `install` (studio install token), `key` (API key),
  `oauth` or `x402`.
- Writes happen after the response is sent, buffered and flushed in batches (250 ms
  or 100 events). A failed write is logged (`mcp-clients flush_failed`) and
  dropped; it never reaches the caller. Request bodies, arguments, IPs and
  headers are never stored, only the normalized client name, its version, the
  auth kind and tool names.

Surfaces tracked: `mcp`, `mcp-3d`, `mcp-agent`, `mcp-bazaar`, `pump-fun-mcp` and
the studio handler (`full`, `chatgpt`, `grok`).

A `tools/call` that carries no id this platform issued (a client that skipped
`initialize`, a plain x402 agent, curl) still counts, under client `unknown`
for its surface and auth kind, and the board shows it as "unattributed".

## Reading it

`GET /api/ops/mcp-clients?days=30` (1 to 365), admin only: `401` without a
session, `403` for a signed-in non-admin, `503` `migration_pending` before the
migration is applied. It returns totals, a per-client list (sessions, calls,
share of calls, the raw names and versions sent, surfaces, auth kinds, top 5
tools) and a zero-filled daily series for the chart.

```bash
curl -s -H "Cookie: $SESSION" "https://three.ws/api/ops/mcp-clients?days=7" | jq '.clients[] | {client, sessions, calls, top_tools}'
```

`totals.unattributed_share` is the fraction of calls whose client is `unknown`
because the caller never echoed the session id. When it is high, the client
list is a floor, not a count.

To see a local run, serve with `DATABASE_URL` loaded
(`node --env-file=.env.local server/index.mjs`, a spare port if `3000` is
already running the dev server) and run
`npm run probe:mcp-clients -- --base http://localhost:3000`. The probe
identifies itself as `three-ws-connector-probe`, so every session it opens
shows up as client `probe`.

## Tables and retention

Tables from migration
[`20261009172000_mcp_client_analytics.sql`](../../api/_lib/migrations/20261009172000_mcp_client_analytics.sql):

- `mcp_client_sessions`: raw, one row per issued session id, with its call
  count. Deleted by [db-retention](db-retention.md) once idle for 30 days.
- `mcp_client_daily`: durable aggregate per day, surface, client name, version
  and auth kind: sessions opened and calls made. The board reads only this and
  `mcp_client_tool_daily`, and both are kept indefinitely.
- `mcp_client_tool_daily`: durable aggregate of calls per tool for the same
  day, surface, client and auth kind.

Days are UTC (`current_date` on the database).
