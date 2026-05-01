---
name: tool-registry-guide
description: Guide to Lyra Registry — a standalone API and MCP service cataloging, scoring, and serving metadata for 800+ crypto, blockchain, DeFi, memecoin, NFT, metaverse, and trading tools. Enables discovery, evaluation, and integration of tools in the Lyra/Sperax ecosystem.
license: MIT
metadata:
  category: development
  difficulty: intermediate
  author: nich
  tags: [development, tool-registry-guide]
---

# Lyra Tool Registry Guide

Lyra Registry is a standalone API + MCP service that catalogs, scores, and serves metadata for 800+ crypto and DeFi tools. It's the discovery layer for the Sperax/Lyra ecosystem.

## What's in the Registry

| Category | Count | Examples |
|----------|-------|---------|
| **DeFi Protocols** | 200+ | Aave, Compound, Uniswap, Sperax |
| **Market Data** | 100+ | CoinGecko, DeFi Llama, DexScreener |
| **Trading Bots** | 80+ | Grid bots, DCA tools, arbitrage |
| **Wallet Tools** | 60+ | Validators, generators, managers |
| **NFT Tools** | 50+ | Marketplaces, analytics, minting |
| **Security** | 40+ | Audit tools, honeypot detection |
| **Bridge/Cross-Chain** | 50+ | Across, Stargate, Wormhole |
| **MCP Servers** | 100+ | All registered MCP servers |
| **Other** | 120+ | Governance, education, analytics |

## API Endpoints

### Search Tools
```bash
# Search by keyword
curl https://registry.lyra.tools/api/search?q=stablecoin

# Filter by category
curl https://registry.lyra.tools/api/tools?category=defi&chain=arbitrum

# Get trending tools
curl https://registry.lyra.tools/api/trending

# Get tool details
curl https://registry.lyra.tools/api/tools/sperax-usds
```

### Tool Scoring
Every tool has a quality score based on:

| Factor | Weight | Description |
|--------|--------|-------------|
| **Documentation** | 20% | README quality, guides, API docs |
| **Maintenance** | 20% | Recent commits, issue response time |
| **Community** | 15% | Stars, forks, contributors |
| **Security** | 20% | Audits, dependencies, practices |
| **Functionality** | 15% | Feature completeness, reliability |
| **Compatibility** | 10% | MCP support, standard compliance |

### Example Score

```json
{
  "name": "sperax-crypto-mcp",
  "score": 0.92,
  "breakdown": {
    "documentation": 0.95,
    "maintenance": 0.90,
    "community": 0.85,
    "security": 0.95,
    "functionality": 0.93,
    "compatibility": 0.98
  }
}
```

## MCP Server

The registry itself is an MCP server:

```json
{
  "mcpServers": {
    "lyra-registry": {
      "command": "npx",
      "args": ["@nirholas/lyra-registry", "serve"]
    }
  }
}
```

### MCP Tools
- `searchTools` — Search registry by keyword/category
- `getToolDetails` — Full metadata for a specific tool
- `getTrending` — Currently trending tools
- `compareTools` — Side-by-side comparison
- `getRecommendations` — AI-recommended tools for a task
- `getByChain` — Tools filtered by blockchain

## Tool Metadata Schema

```json
{
  "id": "sperax-usds",
  "name": "Sperax USDs",
  "description": "Auto-yield stablecoin on Arbitrum",
  "category": "defi",
  "subcategory": "stablecoin",
  "chains": ["arbitrum"],
  "url": "https://app.sperax.io",
  "github": "https://github.com/nirholas/sperax-crypto-mcp",
  "mcp": true,
  "mcpPackage": "@nirholas/sperax-crypto-mcp",
  "score": 0.92,
  "tags": ["stablecoin", "yield", "arbitrum", "sperax"],
  "lastUpdated": "2026-02-20"
}
```

## Use Cases

### AI Agent Tool Selection
Agent queries the registry to find the best tool for a specific task:
```
User: "I need to track my DeFi positions across chains"
Agent → Registry: searchTools("portfolio tracking multi-chain")
Registry → Agent: [zapper, debank, sperax-portfolio, ...]
Agent: Recommends the highest-scored option
```

### SperaxOS Integration
The registry powers tool discovery in the SperaxOS skill marketplace, helping users find and install the right tools for their agents.

## Links

- GitHub: https://github.com/nirholas/lyra-registry
- Lyra Discovery: https://github.com/nirholas/lyra-tool-discovery
- Sperax: https://app.sperax.io
