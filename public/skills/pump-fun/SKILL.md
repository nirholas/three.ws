# pump-fun

Read-only Solana market intel for three.ws agents. Proxies the
[pump-fun-workers](https://github.com/nirholas/pump-fun-workers) MCP server
(Cloudflare Worker) so any agent can search, inspect, and rug-check pump.fun
tokens during conversation.

## Tools

| Tool | Use it for |
|---|---|
| `searchTokens` | Find a token by name, symbol, or mint |
| `getTokenDetails` | Full metadata for a mint |
| `getBondingCurve` | Reserves, price, graduation % |
| `getTokenTrades` | Recent buy/sell history |
| `getTrendingTokens` | Top by market cap |
| `getNewTokens` | Most recent launches |
| `getGraduatedTokens` | Tokens that hit Raydium |
| `getKingOfTheHill` | Highest mcap still on the curve |
| `getCreatorProfile` | Creator's tokens + rug flags |
| `getTokenHolders` | Top holders + concentration |

All tools are read-only. No wallet keys are required or accepted.

## Endpoint

Defaults to `https://pump-fun-sdk.modelcontextprotocol.name/mcp`. Override per
install via `manifest.config.endpoint` to point at a self-hosted Worker.

## Install

Reference the bundle from your agent manifest:

```json
{
  "skills": [
    { "uri": "https://cdn.three.ws/skills/pump-fun/" }
  ]
}
```

## Suggested instructions

> When the user mentions a token name, symbol, or mint address, call
> `searchTokens` first, then `getBondingCurve` and `getTokenHolders` before
> giving an opinion. Always check `getCreatorProfile` for rug flags before
> recommending a buy.
