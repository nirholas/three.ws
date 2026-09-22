# 05. Agents REST parity: runs, lifecycle, model catalog, intelligence, integrations and link codes

Read `docs/prompts/README.md` first.

## The problem

The agent runtime exists (`api/agent/run.js` runs a server-side tool loop; `api/agent/activity.js` and `api/audit-log.js` log it) but runs are not first-class objects a developer can create, list, inspect step by step, update or cancel. Several capabilities a developer expects from an agents API are either scattered or missing: start and stop as explicit lifecycle states, a model catalog endpoint with prices, a free-tier status endpoint, technical indicators and top movers as JSON, integrations as a listable object, and a short link code for connecting a browser session to an agent from another device. Prompt 06 wraps this API in an SDK; prompt 02 exposes it as resources; prompt 13 delivers it to chat gateways.

## Build

All routes under `api/v1/agents/...` (add a `/api/v1` route family in `vercel.json` served by `server/index.mjs`), keyed by API key or OAuth token with the existing scopes. Every response carries `meta: { requestId, timestamp }`. Errors use one envelope `{ error: { code, message, details } }` with stable codes.

### Lifecycle

- `POST /agents` (name, persona, systemPrompt, model, temperature, skills, strategy preset), `GET /agents`, `GET /agents/:id`, `PATCH /agents/:id`, `DELETE /agents/:id`.
- `POST /agents/:id/start` and `/stop`: status `running` means scheduled automations, intents and runs may execute; `stopped` pauses all of them without deleting anything. Persist `status` and surface it everywhere the agent is listed.
- Strategy presets: `momentum`, `sniper`, `defi-yield`, `macro-hedge`, `monitor-exit`, `conservative`, each a documented bundle of skills, persona text and default automations, stored in `data/agent-strategies.json` and validated at build.

### Chat

- `POST /agents/:id/messages` (message, model override, temperature override) returns content, usage, cost in credits, tool calls made, and transaction signatures if any. `GET /agents/:id/messages` with `limit` and `before` cursor and `hasMore`.

### Runs

- `POST /agents/:id/runs` (goal, budget in credits and USD, max steps, tools allowed, schedule or immediate), `GET /agents/:id/runs`, `GET /runs/:runId`, `PATCH /runs/:runId` (pause, resume, raise budget), `POST /runs/:runId/cancel`, `GET /runs/:runId/steps` (every model call, tool call, result, cost and timestamp), and an SSE stream `GET /runs/:runId/events`. Migration for `agent_runs` and `agent_run_steps`. Runs execute through the existing runtime loop in `api/agent/run.js` with GuardChain preflight and never exceed `enforceSpendLimit`.

### Automations

Expose the existing wallet intents and alert rules (`api/_lib/wallet-intents.js`, `api/alerts/_rules.js`) as one automation object: `POST /automations` with `trigger` (`price_threshold` with mint, operator, priceUsd; `schedule` with cron; `balance_below`; `tip_received`; `launch_matching`; `graduation`; `whale_buy`) and `action` (`agent_prompt`, `swap`, `transfer`, `notify`), `triggerOnce`, `GET /agents/:id/automations`, `DELETE /automations/:id`. Same guards as intents.

### Catalog and account

- `GET /models`: every model in `api/_lib/chat-models.js` with input and output price, context window, and which are free-tier.
- `GET /me/free-tier`: remaining free messages and reset time.
- `GET /me/usage`, `GET /me/budget`, `GET /me/transactions`: from `api/usage/summary.js`, `api/credits/`, `api/billing/`.
- `GET /me/integrations`, `PUT /me/integrations/:provider`, `DELETE /me/integrations/:provider`: X posting config and the other linked accounts that exist today, as one object.
- `POST /me/link-code` and `POST /me/link-code/redeem`: an eight-character code that pairs a device or chat gateway to the account for ten minutes; prompt 13 consumes it.
- `PUT /agents/:id/external-wallet` (`financial` tier, `confirm_transfer`): set a withdrawal destination, subject to the allowlist.

### Intelligence

- `GET /intel/price?mint=`, `GET /intel/top-movers?timeframe=&sortBy=&minLiquidity=`, `GET /intel/indicators?mint=&indicators=rsi,ema,sma,macd&interval=`, `GET /intel/signals?mint=`, `GET /intel/anomalies`, `GET /intel/macro`. Back them with the data the radar, coin-intel and fade surfaces already fetch (`docs/trading-surfaces.md`); compute indicators server-side from the OHLCV we already pull, with a well-adopted npm indicators library rather than hand-rolled math.

### MCP

Every route above gets a tool on `/api/mcp-agent` under the policy from prompt 03 (`list_agent_runs`, `create_agent_run`, `update_agent_run`, `cancel_agent_run`, `get_agent_run_steps`, `get_model_catalog`, `get_free_tier_status`, `get_indicators`, `get_top_movers`, `list_integrations`, `save_integration`, `remove_integration`, `generate_link_code`, `set_external_wallet`, and so on).

## Docs and wiring

- `docs/api-reference.md`: a full `v1 Agents API` section in the format of the neighboring sections, every route with request, response and error codes.
- `docs/agent-runtime.md`: runs and steps.
- `data/changelog.json` entry tagged `feature, sdk`. `STRUCTURE.md` row for `api/v1/`.

## Acceptance

- A run created with a goal and a budget executes, its steps stream over SSE, and cancelling it stops the loop within one step.
- `stop` on an agent prevents an automation from firing; `start` resumes it.
- `GET /intel/indicators` for the wrapped SOL mint returns RSI within 0 to 100 and matches a reference calculation in the test.
- `npm test` green with route tests for every family.
