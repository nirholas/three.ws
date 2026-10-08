# MCP clients board

Which AI clients use the hosted MCP servers, and what they do there: how many
sessions Claude, ChatGPT, Cursor, Grok Bot and everyone else open, how many
tools each calls, which tools, and how each one signed in. It answers whether
the Grok Bot work is landing and which client to optimize next.

- **[/mcp-clients](../../pages/mcp-clients.html)**, the internal board.
- `GET /api/ops/mcp-clients?days=30`, the JSON behind it.

Both need a signed-in platform admin (`requireAdmin`): no session answers
`401`, a signed-in account that is not an admin answers `403`. The page is
`noindex` and not in `data/pages.json`.

## How a session is counted

Every MCP client sends `clientInfo: { name, version }` on `initialize`. Each
hosted server (core `/api/mcp`, `/api/mcp-3d`, the free studio
`/api/mcp-studio`, `/api/mcp-chatgpt`, `/api/mcp-grok`, `/api/mcp-agent`,
`/api/mcp-bazaar`, `/api/ibm-mcp`) now answers `initialize` with an
`Mcp-Session-Id` header (`mcs_<uuid>`, or `grk_<uuid>` on the Grok surface,
whose per-caller rate caps key on it) and records one session row. A
conforming client echoes the id on every later request, so each `tools/call`
is counted against the client that opened the session.

The id holds no server state. Requests are still served statelessly, and a
`DELETE` carrying one of these ids answers `204` (any other id still answers
the transport's `404`, "start a new session").

What is stored, and nothing else:

| Field | Value |
|---|---|
| `client_name` | `clientInfo.name`, control characters stripped, trimmed, lowercased, capped at 64 characters |
| `client` | the family that name belongs to: `claude`, `claude-code`, `chatgpt`, `grok`, `cursor`, `vscode`, `windsurf`, `gemini`, `mcp-inspector`, `cline`, `zed`, `goose`, `probe`. A name matching none is its own family. Mapping: `FAMILIES` in [`api/_lib/mcp-client-analytics.js`](../../api/_lib/mcp-client-analytics.js) |
| `client_version` | `clientInfo.version`, capped at 32 characters |
| `surface` | the server it connected to (`mcp`, `mcp-3d`, `mcp-studio`, `mcp-chatgpt`, `mcp-grok`, ...) |
| `auth_kind` | `anonymous`, `install` (free studio install token), `key` (API key), `oauth`, `x402` |
| tool counts | `{ tool_name: calls }`. A caller cannot grow it without bound: past 200 distinct names every new one folds into `(other)` |

No request body, prompt or tool argument is ever stored.

A `tools/call` that carries no id this platform issued (a client that skipped
`initialize`, a plain x402 agent, curl) still counts, under client `unknown`
for its surface and auth kind, and the board shows it as "unattributed".

## Write path

[`trackMcpRequest`](../../api/_lib/mcp-client-analytics.js) runs once per POST,
after auth and rate limits pass and before the response is written. It only
sets the header and queues events in memory. A timer flushes the queue in one
batch about 250 ms later, after the response has gone: sessions first (one
multi-row insert), then one statement per session and tool. A failed flush is
logged as `[mcp-clients]` and dropped; telemetry never slows or fails a tool
call.

## Tables and retention

Migration `api/_lib/migrations/20261008200000_mcp_client_analytics.sql`:

- `mcp_client_sessions`: one row per issued session id, with its call count
  and per-tool counts. Raw join data, deleted by
  [db-retention](db-retention.md) once idle for 30 days.
- `mcp_client_daily`: one row per day, surface, client name, version and auth
  kind, with sessions, calls and per-tool counts. The board reads only this,
  and it is kept.

Days are UTC (`current_date` on the database).

## Reading it

```bash
curl -s -H "Cookie: __Host-sid=<admin session>" "https://three.ws/api/ops/mcp-clients?days=30" \
  | jq '.clients[] | {client, sessions, calls, top_tools}'
```

`days` is 1 to 365, default 30. The response carries `totals`, `clients`
(sessions, calls, calls per session, the raw names and versions sent, auth
mix, surfaces, top 5 tools), `surfaces`, the top 10 `tools`, and a zero-filled
`daily` series per client for the chart. A failed read answers `207` with the
failing table named in `degraded`; before the migration is applied that is
`relation "mcp_client_daily" does not exist`, and the board says so.

## Checking it locally

Run the API from your tree beside the dev server (see
[Client compatibility in docs/mcp.md](../mcp.md#client-compatibility)), point
it at a throwaway database ([`scripts/use-local-neon.mjs`](../../scripts/use-local-neon.mjs)),
then run the connector probe. It identifies itself as
`three-ws-connector-probe`, so every session it opens shows up as client
`probe`:

```bash
npm run probe:mcp-clients -- --base http://localhost:3107
```

Tests: [`tests/mcp-client-analytics.test.js`](../../tests/mcp-client-analytics.test.js)
(the real migration in PGlite) and
[`tests/api/ops-mcp-clients.test.js`](../../tests/api/ops-mcp-clients.test.js)
(the admin gate).
