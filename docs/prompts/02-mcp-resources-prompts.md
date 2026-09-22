# 02. MCP resources and guided prompts on every hosted server

Read `docs/prompts/README.md` first.

## The problem

Our hosted MCP servers expose tools only. `api/_mcp/dispatch.js` (around line 103) answers `resources/list` and `prompts/list` with empty arrays, and only `api/_mcp-studio/dispatch.js` implements one real resource. A client that renders resources (Claude Desktop, Cursor, most agent frameworks) therefore shows nothing to read, and a model has no guided workflows to follow. The best agent platforms ship live read-only views under a URI scheme and a short catalog of prompt flows that walk a user from zero to a first result.

## Build

### Resources (`three://` scheme)

Implement `resources/list`, `resources/read`, `resources/templates/list` and `resources/subscribe` (with `notifications/resources/updated` over the existing Streamable HTTP session) in a shared module `api/_mcp/resources.js` used by `/api/mcp`, `/api/mcp-agent`, `/api/mcp-3d` and `/api/mcp-bazaar`. Each resource is JSON with `mimeType: application/json`, plus a `text/markdown` rendering when the client asks for it.

Required resources, all backed by the real routes named:

- `three://me`: account, plan, scopes of the current key or token, rate-limit state (`api/usage/summary.js`, `api/api-keys.js`).
- `three://agents` and `three://agents/{agentId}`: the caller's agents (`api/marketplace/[action].js` `mine`, agent detail route).
- `three://agents/{agentId}/wallet`: address, SOL and token balances, spend limits, allowlist, freeze state (`api/agents/solana-wallet.js`, `api/_lib/agent-trade-guards.js`, `api/agents/solana-guard.js`).
- `three://agents/{agentId}/usage`: credits, monthly LLM calls and tokens per model, MCP tool calls (`api/usage/summary.js`, `api/credits/`).
- `three://agents/{agentId}/chat`: recent chat history (`api/brain/chat.js` storage).
- `three://agents/{agentId}/runs` and `three://agents/{agentId}/runs/{runId}`: autonomous runs and steps (prompt 05 defines the routes; if it has not landed, back these with `api/agent/activity.js` and extend when it does).
- `three://agents/{agentId}/orders`, `.../dca`, `.../intents`: open orders (`api/agents/orders.js`), DCA strategies (`api/dca-strategies.js`), wallet intents (`api/_lib/wallet-intents.js`).
- `three://marketplace`: skill listings with prices and trial state (`api/marketplace/`).
- `three://models`: the model catalog with pricing (`api/_lib/chat-models.js`, `api/_lib/llm-pricing.js`).
- `three://wallets`: summary across all the caller's agent wallets.
- `three://launches`: the caller's token launches (`api/pump/[action].js`, `pump_agent_mints`).
- `three://x402/services`: the bazaar catalog (`api/_mcpbazaar/tools.js`).
- `three://assets/{id}` on `/api/mcp-3d`: asset metadata and GLB URL.

Each resource also has an equivalent tool so clients without a resource reader can get the same data. State that mapping in the resource description.

### Prompts

Implement `prompts/list` and `prompts/get` in `api/_mcp/prompts.js`, shared the same way. Each prompt returns a message sequence that names the exact tools to call in order, the confirm flags from prompt 03, and what to show the user before executing. Required prompts, with arguments where noted:

`get-started`, `create-agent` (name, persona, model), `setup-wallet` (agentId), `trade` (agentId, token), `launch-token` (agentId, name, symbol), `hire-agent` (task), `sell-a-skill` (agentId), `review-costs` (agentId), `setup-automations` (agentId), `setup-dca` (agentId), `explore-marketplace`, `explore-x402` (capability), `earn-yield` (agentId), `perps` (agentId), `predictions` (agentId), `embed-avatar` (agentId), `generate-3d` (prompt).

Prompts that reference a surface from a later brief (perps, lending, predictions) must still be real: they point at the tools those briefs define, and until those land they say plainly that the venue is not yet enabled and list the read-only research tools that do exist.

### Directory and docs

- `/.well-known/mcp.json` and `server.json` list resources and prompts per server.
- `docs/mcp.md`: a "Resources" section and a "Guided prompts" section, one table each, with a worked `resources/read` example and a `prompts/get` example that actually run against production.
- `data/changelog.json` entry tagged `feature, sdk`.

## Acceptance

- Claude Desktop shows the `three://` resources in its attachment picker and reads them.
- `resources/subscribe` on `three://agents/{id}/wallet` produces an update notification after a real transfer.
- Every prompt renders and every tool it names exists on that server (a test enumerates prompts and checks the tool names against `tools/list`).
- Tests in `tests/mcp-resources.test.js` and `tests/mcp-prompts.test.js`; `npm test` green.
