# HQ and agent integration

HQ (`apps/hq`) is the DeFi dashboard. This is how the host page, agents and MCP clients use it.

## Host bridge (iframe)

The platform page embeds HQ and talks to it with `window.postMessage`. HQ only accepts parents on `https://*.three.ws` or an exact entry in `ALLOWED_ORIGINS` (`apps/hq/src/services/hq-bridge-origins.ts`). The earlier `*.vercel.app` wildcard let any Vercel project drive the bridge and is gone.

HQ posts `hq:ready {version, variant}` as soon as its layout is built, before the first data load finishes, so a host can send commands within seconds of the frame loading.

Data commands (validated in `hq-bridge-protocol.ts`, answered with the same `id`):

| Command | Reply event |
| --- | --- |
| `host:get-panel-data {id, key}` | `hq:panel-data {id, key, data, updatedAt}` (JSON snapshot of a registered panel) |
| `host:run-query {id, tool+args or question}` | `hq:query-result` |
| `host:get-portfolio-risk {id, positions}` | `hq:query-result` |

Failures arrive as `hq:error` with a code: `bad_request`, `unknown_panel`, `too_large` (256 KB cap), `upstream_failed`, `timeout`. A query has 20 seconds end to end, including reading the reply body; a body that is cut off, unreadable or not a JSON object is an error, never an empty `hq:query-result`. Panels expose data with `registerPanelData` (`panel-data-registry.ts`). Registered keys: `markets`, `polymarket`, `news-clusters`, `panels`; DeFi data (yields, TVL, health, funding) is reached through `host:run-query` instead.

`updatedAt` is the ISO time the panel's feed last landed (`markPanelDataLoaded`), or `null` while that feed has not loaded yet, so a host can tell "no data yet" from "empty market". `panels` is registered as live and always reports the time of the read. Data restored from a saved snapshot carries the snapshot's time.

The host side is `src/hq-host.js` (`createHqHost`). It accepts replies only from the exact HQ origin and frame window, correlates by id, and times out.

```js
import { createHqHost } from './hq-host.js';
const hq = createHqHost({ frame, origin: hqOrigin, agentId, apiFetch }); // hqOrigin: where HQ is served (HQ_BASE)
hq.on('hq:ready', async () => {
  const { data, updatedAt } = await hq.getPanelSnapshot('markets'); // updatedAt null until loaded
  const yields = await hq.runTool('top_yields', { chain: 'Solana', symbol: 'USDC', limit: 5 });
  const answer = await hq.ask('where can I stake SOL for the highest APY?');
});
```

`getPanelData(key)` resolves the data alone; `getPanelSnapshot(key)` resolves `{key, data, updatedAt}`.

## Alerts to agent proposals

HQ price/funding/gas alerts are compound rules (up to 4 clauses, all/any) in the Price Alerts panel. A rule can opt in to "Offer to my agent". On trigger HQ emits `hq:alert-triggered`; `hq-host.js` then POSTs `{action: 'propose'}` to `/api/autopilot/proposals`. The server accepts only reversible kinds (`briefing`, `create_alert`), rejects `wallet_transfer` and `trade`, dedupes against pending proposals, and records a grounding memory. The owner still approves in Autopilot. HQ never evaluates rules server-side; evaluation runs in the open panel.

## Agent tools API

`GET /api/agent-tools` lists the catalog. `POST` takes `{tool, args}` or `{question, narrate?}`. Tools: `top_yields`, `chain_tvl`, `protocol_health`, `funding_rates`, `liquidations`, `venue_spread`, `whale_activity`, `gas`, `portfolio_risk`. Read-only, CORS and IP rate limited.

`top_yields` takes `chain`, `symbol`, `minTvl`, `stablecoinOnly`, `limit`. `symbol` keeps single-asset pools of that token only (a `SOL-USDC` LP is not a USDC pool). The question router fills `chain` and `symbol` from the text, so "best USDC yield on Solana" becomes `{chain: 'Solana', symbol: 'USDC'}`.

With `narrate: true` the result gains a two-sentence `narrative` and `narrativeProvider` (`groq` or `openrouter`). Narration tries Groq first, then OpenRouter's free tier; when every lane is capped the data still returns with no narrative. Groq calls go through `api/_groq.js`, which walks an ordered model list and moves on when a model is retired (404/model_not_found) or its bucket is exhausted (429/503). Groq meters daily tokens per model, so the list is three models deep: `qwen/qwen3.8-27b`, then `openai/gpt-oss-120b`, then the instant `openai/gpt-oss-20b`.

## MCP

`packages/hq-mcp` exposes the same tools to any MCP client. Set `HQ_BASE` to the HQ origin. See its README.

## Tests

`cd apps/hq && npm run test:data`; `npx vitest run tests/hq-host.test.js tests/autopilot.test.js`; `cd packages/hq-mcp && npm test`.

Browser coverage lives in `apps/hq/e2e/`: `host-bridge.spec.ts` (hq:ready, correlated panel data with freshness, malformed command, live tool query, a compound rule firing `hq:alert-triggered` across the frame) and `alert-rules.spec.ts` (rule builder states, persistence, legacy migration). The tool-query and alert-firing cases need the HQ server, because Vite dev does not serve `api/*.js`; run `npm run build && node scripts/cloudrun-server.mjs` and point Playwright's `baseURL` at it. Under Vite dev those two cases skip with that reason.
