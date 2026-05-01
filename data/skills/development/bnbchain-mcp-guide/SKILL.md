---
name: bnbchain-mcp-guide
description: Guide to the BNB Chain MCP server — developer tools for AI crypto agents including DeFi trading, DEX swaps, smart contract deployment, token operations, staking, bridging, wallet automation, honeypot detection, security analysis, price oracles, market data, and protocol analytics on BSC and opBNB.
license: MIT
metadata:
  category: development
  difficulty: intermediate
  author: nich
  tags: [development, bnbchain-mcp-guide]
---

# BNB Chain MCP Server Guide

Developer tools for AI crypto agents on BNB Smart Chain (BSC) and opBNB. Build apps with DeFi trading, DEX swaps, smart contract deployment, token operations, staking, bridging, wallet automation, honeypot detection, security analysis, price oracles, market data, and protocol analytics.

## Capabilities

| Category | Tools | Description |
|----------|-------|-------------|
| **DeFi Trading** | Swap, LP management | Trade on PancakeSwap, Venus, and more |
| **DEX Swaps** | Best-route aggregation | Find optimal swap routes across BSC DEXs |
| **Smart Contracts** | Deploy, verify, interact | Deploy BEP-20 tokens, verify on BscScan |
| **Token Operations** | Transfer, approve, mint | Manage BEP-20/BEP-721 tokens |
| **Staking** | BNB staking, liquid staking | Stake BNB, manage stkBNB positions |
| **Bridging** | Cross-chain transfers | Bridge between BSC, Ethereum, Arbitrum, etc. |
| **Wallet Automation** | Batch operations | Multi-wallet management and automation |
| **Honeypot Detection** | Token safety checks | Detect honeypots, rugs, and scam tokens |
| **Security Analysis** | Contract auditing | Analyze contract source code for vulnerabilities |
| **Price Oracles** | On-chain prices | Read Chainlink/Band feeds on BSC |
| **Market Data** | Token/protocol stats | Volume, TVL, price history |
| **Protocol Analytics** | DeFi metrics | Lending rates, pool depths, yield data |

## Quick Start

```bash
npx @nirholas/bnbchain-mcp
```

### Claude Desktop Config

```json
{
  "mcpServers": {
    "bnbchain": {
      "command": "npx",
      "args": ["@nirholas/bnbchain-mcp"],
      "env": {
        "BSC_RPC_URL": "https://bsc-dataseed.binance.org",
        "PRIVATE_KEY": "your-private-key"
      }
    }
  }
}
```

## Key DeFi Protocols on BSC

| Protocol | Type | TVL |
|----------|------|-----|
| **PancakeSwap** | DEX/AMM | Top BSC DEX |
| **Venus** | Lending | Compound-style lending |
| **Alpaca Finance** | Leveraged yield | Up to 6x leverage farming |
| **Radiant** | Cross-chain lending | Multi-chain liquid DeFi |
| **Thena** | ve(3,3) DEX | Vote-escrowed tokenomics |

## Security Tools

### Honeypot Detection

```
Tool: detectHoneypot
Input: { "tokenAddress": "0x..." }
Output: {
  "isHoneypot": false,
  "buyTax": 0.5,
  "sellTax": 0.5,
  "isOpenSource": true,
  "hasProxyContract": false
}
```

### Contract Analysis

The MCP server can analyze contract source code for:
- Ownership renouncement status
- Hidden mint functions
- Blacklist/whitelist mechanisms
- Max transaction limits
- Anti-whale mechanisms
- Proxy upgrade patterns

## opBNB Layer 2

opBNB is BNB Chain's L2 based on OP Stack:
- **Gas**: ~$0.001 per transaction
- **Speed**: 1-second block time
- **Compatibility**: Full EVM compatibility
- **Use case**: High-frequency trading, gaming, micropayments

## Agent Use Cases

### BSC Portfolio Manager
Agent monitors holdings across PancakeSwap, Venus, and other BSC protocols, providing yield optimization recommendations.

### Token Screener
AI agent scans new token launches on BSC, runs honeypot detection, and flags safe opportunities.

### Cross-Chain Arbitrage
Agent detects price differences between BSC and Arbitrum DEXs, recommending bridge + swap strategies.

## Sperax on BNB Chain

Sperax has expanded to BNB Chain:
- **SPA token** is available on BSC
- **Plutus vaults** operate on BNB Chain (plvHEDGE, plvLOOP, plvDOLO)
- Bridge SPA between Arbitrum and BSC

## Links

- GitHub: https://github.com/nirholas/bnbchain-mcp
- BNB Chain Docs: https://docs.bnbchain.org
- Sperax: https://app.sperax.io
