# pump-fun-mcp: Cloudflare Workers edge deployment

Mirror of the primary `/api/pump-fun-mcp` endpoint (served by the Cloud Run app in [`server/index.mjs`](../server/index.mjs)), deployable to Cloudflare Workers for sub-50 ms cold starts and region-local edge execution. It is not deployed by three.ws today (no Cloudflare account is wired up); the production endpoint is `https://three.ws/api/pump-fun-mcp`, and this worker is for running the read-only surface on your own Cloudflare account.

## Files

| Path | Purpose |
| :--- | :--- |
| `workers/pump-fun-mcp/worker.js` | CF Workers fetch handler implementing the MCP Streamable HTTP transport |
| `workers/pump-fun-mcp/wrangler.toml` | Wrangler config (`name`, `main`, `compatibility_date`) |
| `workers/pump-fun-mcp/README.md` | Full config table and the verified run, build, and deploy commands |
| `src/pump/mcp-tools.js` | Shared tool registry imported by both the Cloud Run and Workers handlers |
| `tests/workers/pump-fun-mcp-worker.test.js` | Covers the worker's MCP surface (`npx vitest run tests/workers/pump-fun-mcp-worker.test.js`) |

## Deploy

```sh
cd workers/pump-fun-mcp
npx wrangler@4 deploy
```

`wrangler` is not a repo dependency, so it is invoked through `npx`.

## Secrets

Set the following with `npx wrangler@4 secret put <NAME>` (or `--var NAME:VALUE` for a local `wrangler dev` run). Everything is optional:

| Name | Required | Description |
| :--- | :--- | :--- |
| `SOLANA_RPC_URL` | No | Primary mainnet RPC endpoint (defaults to the public endpoint) |
| `SOLANA_RPC_FALLBACKS` | No | Comma-separated mainnet failover endpoints, tried in order after the primary (same var name the three.ws deployment uses) |
| `SOLANA_RPC_URL_DEVNET` | No | Primary devnet RPC endpoint (defaults to the public endpoint) |
| `SOLANA_RPC_FALLBACKS_DEVNET` | No | Comma-separated devnet failover endpoints |
| `PUMPFUN_BOT_URL` | No | Upstream indexer MCP endpoint; indexer-backed tools return -32004 without it |
| `PUMPFUN_BOT_TOKEN` | No | Bearer token for the indexer endpoint |

Every on-chain tool walks the configured chain (primary, then each fallback) until one endpoint answers; the public endpoint is used only when nothing is configured, never as a silent downgrade. A tool-level verdict (invalid mint, account genuinely absent) propagates immediately instead of burning the chain, and a provider that is down, rate-limiting, or blocking the egress IP surfaces as `-32004`. `get_token_details` reads name, symbol, and URI from the Token-2022 `TokenMetadata` extension for Token-2022 mints (what pump.fun launches today) and falls back to the legacy Metaplex metadata PDA otherwise.

## Local dev

```sh
npx wrangler@4 dev workers/pump-fun-mcp/worker.js --local
# Test tools/list:
curl -s http://localhost:8787 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[].name'
```

## Tool parity

Both runtimes import the tool definitions and name aliases from `src/pump/mcp-tools.js`, so a tool's name, schema and description are identical wherever it is served. The worker serves only a subset of that catalog: the on-chain and indexer data tools (`get_bonding_curve`, `get_token_details`, `get_token_holders`, `search_tokens`, `get_token_trades`, `get_trending_tokens`, `get_new_tokens`, `get_graduated_tokens`, `get_king_of_the_hill`, `get_creator_profile`, `pumpfun_bot_status`), and its `tools/list` advertises exactly that subset. Indexer-backed tools are hidden until `PUMPFUN_BOT_URL` is set. The full catalog is served only by the Cloud Run handler. `tests/pump-mcp-tools.test.js` covers the shared registry and `tests/workers/pump-fun-mcp-worker.test.js` the worker subset.

## Differences from the primary handler

- No IP rate limiting (handled at the Cloudflare edge layer instead).
- Env vars come from Workers secrets (`env` binding) rather than `process.env`.
- Only the tool subset above. The `kol_*`, SNS, social, claims, vanity and other auth-gated tools depend on three.ws backend modules (bearer auth, x402 settlement, the per-tool enablement policy in `api/_mcp/policy.js`, per-client call tracking) that live in the Cloud Run deployment, so none of that plumbing exists in the worker.
- `get_token_trades` is indexer-only here; the Cloud Run handler can also decode trades from chain.
