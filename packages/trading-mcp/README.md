# @three-ws/trading-mcp

Quote and fill guarded Solana swaps from a three.ws agent wallet, from any MCP client.

The server carries your three.ws credential as a Bearer token and calls the same executor the wallet hub and Autopilot use. Nothing is signed locally. The per-trade cap, daily budget, USD ceiling, price-impact breaker, rug firewall, SOL headroom check and kill switch all run on the three.ws backend, so this server cannot bypass them.

The agent never sells $THREE. A sell of it is refused inside this process before any request is made. `mint` accepts `"three"` (or `"$THREE"`) as a name for the $THREE mint, so a buy never needs the address pasted.

## Install

```bash
THREE_WS_API_KEY=sk_live_... claude mcp add trading -- npx -y @three-ws/trading-mcp
```

```json
{
	"mcpServers": {
		"trading": {
			"command": "npx",
			"args": ["-y", "@three-ws/trading-mcp"],
			"env": { "THREE_WS_API_KEY": "sk_live_..." }
		}
	}
}
```

## Tools

| Tool | Kind | What it does |
| --- | --- | --- |
| `quote_trade` | read-only | Prices a buy (`amountSol`) or sell (`amountTokens` or `tokenAmountRaw`) and runs the guard chain in preview. Returns venue, expected output, minimum received, price impact, fees, wallet balance and any guard or funds warning. |
| `list_positions` | read-only | The wallet's holdings, summarized for a trading decision: SOL, and per token position the amount, USD value, FIFO cost basis and unrealized P&L in SOL, plus net worth and risk flags. `sellable: false` marks $THREE. |
| `execute_trade` | **write, destructive** | Fills a trade. Real funds, irreversible. Needs `confirm: true` and should carry a stable `idempotencyKey`, so a retry fills at most once. |

All tools take `agentId`, the UUID of an agent owned by the credential. Trade tools take `side`, `mint` and `slippageBps` (1 to 500, default 100).

A sell is sized one of two ways:

- `amountTokens`: `"all"` for the whole position, or a token amount such as `12.5`. The server reads the wallet's exact on-chain balance and converts with the mint's decimals (truncating dust, never rounding up), so `"all"` sells exactly what is held.
- `tokenAmountRaw`: exact base units as an integer string.

A sell larger than the position is refused with `insufficient_tokens`, and a sell of a token the wallet does not hold with `no_position`, before any quote is taken.

## Safe flow

1. `list_positions` to see what the wallet holds.
2. `quote_trade` and show the owner the side, mint, size, minimum received and guard verdict.
3. After an explicit yes, `execute_trade` with `confirm: true` and an `idempotencyKey`.

## Credential

`THREE_WS_API_KEY` (aliases `THREE_WS_TOKEN`, `THREE_WS_BEARER`) is required. Quotes and positions work with any owner credential. Filling a trade also needs the `wallet:trade` grant on the key and the owner's signed real-funds agreement; without them the server answers with its own refusal code and nothing is sent.

`THREE_WS_BASE` (default `https://three.ws`) and `THREE_WS_TIMEOUT_MS` (default 60000) are optional.

## Related

- `@three-ws/autopilot-mcp`: the propose, review, execute loop. A `trade` proposal there uses the same executor and counts buys against the daily SOL limit.
- Spec: [docs/specs/agent-trading.md](../../docs/specs/agent-trading.md).

## Test

```bash
node --test packages/trading-mcp/test/registration.test.mjs
```
