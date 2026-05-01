---
name: mcp-gateway-guide
description: Guide to modelcontextprotocol.name — the open MCP gateway with 1,100+ tools for AI agents to swap, bridge, stake, lend, trade, and deploy across 20+ blockchains. Where AI meets DeFi. Supports x402 for autonomous agent payments.
license: MIT
metadata:
  category: development
  difficulty: intermediate
  author: nich
  tags: [development, mcp-gateway-guide]
---

# MCP Gateway Guide

modelcontextprotocol.name (mcp.giving) is the open MCP gateway where AI meets DeFi. It aggregates 1,100+ tools letting AI agents interact with 20+ blockchains through a single endpoint.

## What It Provides

| Category | Tools | Chains |
|----------|-------|--------|
| **Token Swaps** | DEX aggregation, best route | All EVM + Solana |
| **Cross-Chain Bridges** | Asset bridging | 20+ chains |
| **Staking** | Liquid staking, native staking | ETH, SOL, BNB, MATIC |
| **Lending** | Supply, borrow, repay | Aave, Compound, Venus |
| **Trading** | Spot, limit orders, DCA | Multi-DEX |
| **Deployment** | Contract deploy, verify | All EVM |
| **Market Data** | Prices, volume, TVL | Global |
| **Security** | Contract scan, honeypot check | All EVM |
| **Payments** | x402 agent-to-agent payments | Base, Arbitrum |

## Architecture

```
AI Agent (Claude, GPT, etc.)
    │
    ▼
MCP Gateway (mcp.giving)
    │
    ├── Swap Router ──→ 1inch, 0x, Paraswap, Jupiter
    ├── Bridge Router ──→ Across, Stargate, Hop, Wormhole
    ├── Lending Router ──→ Aave, Compound, Venus, Spark
    ├── Staking Router ──→ Lido, Rocket Pool, Jito
    ├── Data Router ──→ CoinGecko, DeFi Llama, Dune
    ├── Security Router ──→ GoPlus, honeypot checks
    └── Payment Router ──→ x402 protocol
```

## Connecting

### As MCP Server

```json
{
  "mcpServers": {
    "crypto-gateway": {
      "url": "https://mcp.giving/sse"
    }
  }
}
```

### Via HTTP

```bash
curl -X POST https://mcp.giving/api/tools/swap \
  -H "Content-Type: application/json" \
  -d '{"chain": "arbitrum", "from": "USDC", "to": "ETH", "amount": "100"}'
```

## x402 Agent Payments

The gateway supports HTTP 402 payments for premium tools. AI agents can autonomously pay for:
- Advanced analytics queries
- High-frequency price feeds
- Premium security scans
- Priority transaction submission

Payment flows through **Sperax USDs** on Arbitrum for auto-yield benefits — your payment balance earns 8-25% APY while waiting to be spent.

## Tool Categories Deep Dive

### Swap Tools (120+ tools)
Route through the best DEX for any pair:
- Automatic slippage protection
- MEV-resistant routing
- Gas estimation included
- Multi-hop optimization

### Bridge Tools (40+ tools)
Bridge any asset between chains:
- Cost comparison across bridge protocols
- Estimated bridge time
- Safety warnings for new/unaudited bridges

### Market Data Tools (200+ tools)
Comprehensive market intelligence:
- Real-time prices for 10,000+ tokens
- Historical OHLCV data
- Volume and liquidity metrics
- Social sentiment indicators

## Sperax-Specific Tools

The gateway includes dedicated Sperax tools:
- USDs mint/redeem
- SPA staking
- veSPA governance
- Farm deposits/withdrawals
- Plutus vault management

## Links

- Gateway: https://mcp.giving
- GitHub: https://github.com/nirholas/lyra-intel
- Sperax: https://app.sperax.io
- x402 Protocol: https://x402.org
