# @three-ws/hq-mcp

MCP server that gives any AI agent the DeFi market tools from three.ws HQ. Read-only: no key, no signer, no payment.

## Tools

| Tool | What it returns |
| --- | --- |
| `hq_top_yields` | Highest-APY pools above a TVL floor |
| `hq_chain_tvl` | Chain TVL ranking and share |
| `hq_protocol_health` | 0-100 protocol health scores |
| `hq_funding_rates` | Perp funding averaged across Binance, Hyperliquid, OKX |
| `hq_liquidations` | Four-hour liquidation totals and long/short skew |
| `hq_venue_spread` | Cross-venue spreads in basis points |
| `hq_whale_activity` | Large ETH transfers and exchange net flow |
| `hq_gas` | Gas price per EVM chain |
| `analyze_portfolio_risk` | 0-100 risk score for positions you supply (nothing stored) |
| `hq_ask` | Plain-language question, routed to the right tool |

## Run

```sh
HQ_BASE=https://your-hq-deployment.example npx @three-ws/hq-mcp
```

`HQ_BASE` is the origin of an HQ deployment serving `/api/agent-tools` (see `apps/hq/api/agent-tools.js`). Without it every call returns a `not_configured` error that names the variable. `HQ_TIMEOUT_MS` (default 25000) bounds each request.

Claude Desktop / `.mcp.json`:

```json
{ "mcpServers": { "hq": { "command": "npx", "args": ["-y", "@three-ws/hq-mcp"], "env": { "HQ_BASE": "https://your-hq-deployment.example" } } } }
```

Scores are heuristics, not financial advice.

## Test

`npm test` runs offline registration checks plus the real handler path against a local HTTP server.
