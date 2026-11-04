# HQ and agent integration

HQ (`apps/hq`) is the DeFi dashboard. This is how the host page, agents and MCP clients use it.

## Host bridge (iframe)

The platform page embeds HQ and talks to it with `window.postMessage`. HQ only accepts parents on `https://*.three.ws` or an exact entry in `ALLOWED_ORIGINS` (`apps/hq/src/services/hq-bridge-origins.ts`). The earlier `*.vercel.app` wildcard let any Vercel project drive the bridge and is gone.

Data commands (validated in `hq-bridge-protocol.ts`, answered with the same `id`):

| Command | Reply event |
| --- | --- |
| `host:get-panel-data {id, key}` | `hq:panel-data` (JSON snapshot of a registered panel) |
| `host:run-query {id, tool+args or question}` | `hq:query-result` |
| `host:get-portfolio-risk {id, positions}` | `hq:query-result` |

Failures arrive as `hq:error` with a code: `bad_request`, `unknown_panel`, `too_large` (256 KB cap), `upstream_failed`, `timeout`. Panels expose data with `registerPanelData` (`panel-data-registry.ts`).

The host side is `src/hq-host.js` (`createHqHost`). It accepts replies only from the exact HQ origin and frame window, correlates by id, and times out.

## Alerts to agent proposals

HQ price/funding/gas alerts are compound rules (up to 4 clauses, all/any) in the Price Alerts panel. A rule can opt in to "Offer to my agent". On trigger HQ emits `hq:alert-triggered`; `hq-host.js` then POSTs `{action: 'propose'}` to `/api/autopilot/proposals`. The server accepts only reversible kinds (`briefing`, `create_alert`), rejects `wallet_transfer` and `trade`, dedupes against pending proposals, and records a grounding memory. The owner still approves in Autopilot. HQ never evaluates rules server-side; evaluation runs in the open panel.

## Agent tools API

`GET /api/agent-tools` lists the catalog. `POST` takes `{tool, args}` or `{question, narrate?}`. Tools: `top_yields`, `chain_tvl`, `protocol_health`, `funding_rates`, `liquidations`, `venue_spread`, `whale_activity`, `gas`, `portfolio_risk`. Read-only, CORS and IP rate limited.

## MCP

`packages/hq-mcp` exposes the same tools to any MCP client. Set `HQ_BASE` to the HQ origin. See its README.

## Tests

`cd apps/hq && npm run test:data`; `npx vitest run tests/hq-host.test.js tests/autopilot.test.js`; `cd packages/hq-mcp && npm test`.
