# Usage feed for Power BI and Excel (OData v4)

three.ws publishes your usage as a read-only OData v4 feed. Power BI Desktop, the Power BI Service (scheduled refresh, no gateway), Excel and any OData v4 client can read it with a revocable key.

- Feed root: `https://three.ws/api/odata/v1/`
- Metadata: `https://three.ws/api/odata/v1/$metadata` (CSDL 4.0)
- Keys: three.ws **Settings, Connect to Power BI or Excel** (`/dashboard/settings#usage-feed`)
- Typed Power Query scripts and a starter report: [`integrations/microsoft/power-bi-usage/`](../integrations/microsoft/power-bi-usage/README.md)

## Entity sets

Every set carries the same five columns describing whose usage a row is: `TeamId`, `TeamName` (empty for a personal key), `UserId`, `UserName`, `UserEmail`. `$metadata` documents every property with a `Core.Description` annotation.

| Set | Grain | Columns beyond the five above | Source |
|---|---|---|---|
| `UsageDaily` | UTC day, person, event kind | `Id`, `Date`, `Metric`, `Quantity`, `Bytes`, `ErrorCount` | `usage_events` |
| `McpToolCalls` | one MCP tool call | `Id`, `Timestamp`, `Tool`, `Status`, `DurationMs`, `ClientId`, `AgentId` | `usage_events` where kind is `tool_call` |
| `LlmUsage` | UTC day, person, provider, model | `Id`, `Date`, `Provider`, `Model`, `Calls`, `InputTokens`, `OutputTokens`, `CostUsd` | `usage_events` where kind is `llm` |
| `Generations` | one Forge 3D job | `Id`, `CreatedAt`, `CompletedAt`, `Tier`, `Path`, `Backend`, `Status`, `Outcome`, `DurationSeconds`, `SizeBytes` | `forge_creations` (internal jobs excluded) |
| `Billing` | marketplace hour, or metered charge day | `Id`, `PeriodStart`, `Granularity`, `Source`, `SubscriptionId`, `Plan`, `Dimension`, `Quantity`, `AmountUsd`, `Status` | `microsoft_saas_usage_events` (test subscriptions excluded) and `usage_events` where kind is `metered` |

Types are exact: dates are `Edm.Date`, instants `Edm.DateTimeOffset` in UTC, counts `Edm.Int64`, money and quantities `Edm.Decimal` with six decimal places. `AmountUsd` is empty for Microsoft Marketplace rows, because Microsoft prices those.

Not in the feed, because three.ws keeps no per-account table for them: storage held over time, and per-request API latency outside MCP tool calls.

## Who sees what

A key belongs to the account that created it and is bound to one of two scopes, chosen when it is created:

- **My own usage**: only that account's rows. A person in a team who creates a personal key sees their own rows, never their teammates'.
- **A team the account owns**: the owner's rows plus the rows of every person whose membership in the team is active right now (`team_people`). People who leave or are deactivated drop out of the next refresh.

A team key stops working as soon as its creator no longer owns the team, or the team is archived. Only the owner can create one.

## Authentication

HTTP Basic: any user name, the feed key as the password. `Authorization: Bearer <key>` is accepted too. A request without valid credentials gets `401` with `WWW-Authenticate: Basic realm="three.ws usage feed"`, so Power BI and Excel prompt for credentials.

Keys start with `tws_feed_`. three.ws stores only their SHA-256 hash, so a key is shown once at creation and cannot be recovered. Keys are read-only: the feed answers `GET` and `HEAD` only (`405` otherwise), and a key opens nothing else on three.ws. Revoking a key in Settings takes effect on its next request.

Creating, revoking and using a key are written to the account's audit log as `usage_feed.key_created`, `usage_feed.key_revoked` and `usage_feed.key_used` (at most one `key_used` row per key per hour, so a refresh that pages through hundreds of requests leaves one line). Settings shows each key's last refresh time.

## Query options

| Option | Supported |
|---|---|
| `$select` | Any declared properties, comma separated |
| `$filter` | `eq ne gt ge lt le`, `and or not`, parentheses, `null` comparisons; `contains startswith endswith tolower toupper trim length year month day hour minute date`; string, integer, decimal, date, date-time and boolean literals |
| `$orderby` | Up to 8 properties, each `asc` or `desc`; the key breaks ties so paging is stable |
| `$top`, `$skip` | Non-negative integers |
| `$count=true` | Adds `@odata.count`; `/<Set>/$count` returns the plain number |
| `<Set>('<key>')` | One row by `Id` |
| `$format` | `json` only |

`$expand`, `$search`, `$apply`, `$compute`, `$levels`, `$index`, `$schemaversion` and paths in `$select` are answered with `501 NotImplemented`, and any other filter syntax with `400 BadRequest`, each with an OData error body naming what was refused, rather than silently ignored.

Examples:

```
GET /api/odata/v1/LlmUsage?$filter=Date ge 2026-11-01 and Provider eq 'openai'&$orderby=CostUsd desc&$top=20
GET /api/odata/v1/McpToolCalls?$select=Timestamp,Tool,Status&$filter=Status ne 'ok'&$count=true
GET /api/odata/v1/Generations/$count?$filter=Status eq 'failed'
```

Power Query folds filters, column selection and row limits you apply in the editor into these options, so only matching rows are transferred.

## Paging

Pages hold up to 1000 rows. A client may ask for fewer with `Prefer: odata.maxpagesize=<n>`; the response then carries `Preference-Applied`. When more rows remain, the page ends with `@odata.nextLink` (a `$skiptoken` URL that keeps every other option). Power BI, Excel and OData client libraries follow it on their own. `$top` is honoured across pages: the page that reaches it has no `nextLink`.

## Limits

| What | Limit |
|---|---|
| Requests per key | 600 per minute (`429` beyond it; the next minute's refresh succeeds) |
| Failed sign-ins per IP | 30 per 10 minutes |
| Creating or revoking keys | 20 per hour per account |
| Active keys per account | 10 |
| `$filter` | 4000 characters, 200 nodes |

## Errors

Errors use the OData JSON error format, `{"error":{"code":"...","message":"..."}}`, with status `400` (malformed query), `401` (no or invalid key), `404` (unknown set or row), `405` (not a read), `429` (rate limit), `501` (unsupported option). Responses carry `OData-Version: 4.0` and `Cache-Control: no-store`.

## Verifying it

```
npx vitest run tests/odata-usage-feed.test.js tests/power-bi-usage-queries.test.js
python3 scripts/validate-odata-csdl.py      # $metadata against the OASIS edmx.xsd and edm.xsd
node scripts/usage-feed-live-check.mjs      # the real server on copied production usage, plus the Settings panel
```

The test suite runs the handler against a full-schema in-process Postgres: scoping for personal and team keys, team keys after an ownership change, archiving and revocation, paging, every query option, the key API and the audit rows. The live check copies the last 30 days of real usage (read only) into a throwaway database under fresh accounts and starts the real server, so the feed and the Settings panel can be exercised end to end with any OData client.

## Code

| Path | Role |
|---|---|
| [`api/odata/v1.js`](../api/odata/v1.js) | The feed endpoint: auth, rate limit, routing, responses |
| [`api/_lib/odata/query.js`](../api/_lib/odata/query.js) | Strict parser and SQL compiler for the query options above |
| [`api/_lib/odata/usage-model.js`](../api/_lib/odata/usage-model.js) | The five entity sets, their types and SQL |
| [`api/_lib/odata/csdl.js`](../api/_lib/odata/csdl.js) | Service document and `$metadata` |
| [`api/_lib/usage-feed.js`](../api/_lib/usage-feed.js) | Keys, scope resolution, paging, audit |
| [`api/usage/feed-keys.js`](../api/usage/feed-keys.js) | Create, list and revoke keys (session and CSRF) |
| [`src/dashboard-next/pages/settings-usage-feed.js`](../src/dashboard-next/pages/settings-usage-feed.js) | The Settings panel |

Microsoft, Power BI, Power Query and Excel are trademarks of the Microsoft group of companies.
