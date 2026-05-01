---
name: agenti-mcp-guide
description: Guide to Agenti — a universal MCP server for AI agents to interact with 20+ blockchains. 380+ tools for DeFi, DEX aggregation, security scanning, cross-chain bridges, QR payments. x402 enabled for autonomous agent-to-agent payments. Works with Claude, ChatGPT, Cursor, and any MCP-compatible client.
license: MIT
metadata:
  category: development
  difficulty: intermediate
  author: nich
  tags: [development, agenti-mcp-guide]
---

# Agenti — Universal Crypto MCP for AI Agents

Agenti is a production-ready MCP server that gives AI agents access to money and DeFi across 20+ blockchains. With 380+ tools, it's the most comprehensive crypto MCP available.

## What Agenti Does

| Capability | Tools | Example |
|-----------|-------|---------|
| **DeFi Trading** | Swap, bridge, stake, lend | "Swap 100 USDC for ETH on Arbitrum" |
| **DEX Aggregation** | Best-price routing across DEXs | "Find best swap route for 1 ETH → USDT" |
| **Security Scanning** | Contract analysis, honeypot detection | "Is this token contract safe?" |
| **Cross-Chain Bridges** | Bridge assets between chains | "Bridge 500 USDC from Ethereum to Arbitrum" |
| **Wallet Management** | Balance checks, transaction history | "Show my wallet balances on all chains" |
| **QR Payments** | Generate/scan payment QR codes | "Generate a payment QR for 50 USDC" |
| **x402 Payments** | Agent-to-agent autonomous payments | "Pay 0.01 USDC for this API call" |

## Supported Chains

Ethereum, Arbitrum, Base, Polygon, BSC, Optimism, Avalanche, Fantom, Gnosis, zkSync, Scroll, Linea, Mantle, Blast, Mode, Celo, Moonbeam, and more.

## Quick Start

```bash
npx agenti
```

Or install globally:

```bash
npm install -g agenti
agenti start
```

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "agenti": {
      "command": "npx",
      "args": ["agenti"]
    }
  }
}
```

## x402 Agent Payments

Agenti supports the x402 payment protocol, enabling AI agents to autonomously pay for premium APIs and trade with other agents using crypto. This is particularly powerful with **Sperax USDs** on Arbitrum, where payments also earn auto-yield.

### How x402 Works

1. Agent requests a paid API endpoint
2. Server returns HTTP 402 (Payment Required)
3. Agent signs a payment authorization using EIP-3009
4. Payment is verified on-chain
5. API responds with the requested data

## Tool Categories

### Market Data Tools
- `getTokenPrice` — Current price for any token
- `getMarketOverview` — Global crypto market stats
- `getTrendingTokens` — Currently trending tokens
- `getTokenInfo` — Detailed token metadata
- `getPriceHistory` — Historical price data with charts

### DeFi Trading Tools
- `swapTokens` — Execute token swaps via DEX aggregators
- `getSwapQuote` — Get swap quotes without executing
- `bridgeTokens` — Cross-chain bridge operations
- `stakeTokens` — Stake tokens in protocols
- `lendTokens` — Supply to lending protocols

### Wallet Tools
- `getBalance` — Check wallet balances
- `getTransactionHistory` — Recent transactions
- `getApprovals` — Token approval states
- `revokeApproval` — Revoke dangerous approvals

### Security Tools
- `analyzeContract` — Smart contract security analysis
- `detectHoneypot` — Check if a token is a honeypot
- `scanToken` — Full token safety report

## Use Cases

### Portfolio Assistant
An AI agent that monitors your portfolio across chains, suggests rebalancing opportunities, and executes approved trades via Agenti.

### DeFi Yield Hunter
Agent scans for best yields across protocols, calculates risk-adjusted returns, and moves funds to optimal positions.

### Security Guardian
AI agent that monitors your wallet's approvals, alerts on suspicious contracts, and helps revoke dangerous permissions.

## Integration with SperaxOS

Agenti integrates with SperaxOS as a built-in tool provider. The SperaxOS agent workspace can use Agenti tools for:
- Portfolio tracking across all supported chains
- Executing DeFi strategies defined in the strategy engine
- Real-time market data for the daily report tool
- USDs yield monitoring via the Sperax protocol tools

## Links

- GitHub: https://github.com/nirholas/agenti
- Sperax (DeFi on Arbitrum): https://app.sperax.io
- MCP Specification: https://modelcontextprotocol.io
