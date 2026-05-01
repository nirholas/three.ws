---
name: ai-plugin-marketplace-guide
description: Guide to plugin.delivery — a marketplace and delivery infrastructure for AI plugins and MCP servers. Covers plugin discovery, version management, secure distribution, and integration with Claude Desktop, Cursor, and SperaxOS. The npm for AI tools.
license: MIT
metadata:
  category: development
  difficulty: intermediate
  author: nich
  tags: [development, ai-plugin-marketplace-guide]
---

# plugin.delivery — AI Plugin Marketplace Guide

plugin.delivery is the marketplace and delivery infrastructure for AI plugins and MCP servers. Discover, install, and manage AI tools — like npm for AI.

## What Is plugin.delivery?

```
Developers                    Users
    │                           │
    ▼                           ▼
 Publish Plugin ──→ plugin.delivery ──→ Install Plugin
    │                    │                    │
    ├── MCP Servers      ├── Search           ├── Claude Desktop
    ├── OpenAI Plugins   ├── Reviews          ├── Cursor
    ├── Tool Manifests   ├── Versions         ├── SperaxOS
    └── API Specs        └── Security Scan    └── Any MCP Host
```

## Plugin Types

| Type | Format | Compatible With |
|------|--------|----------------|
| **MCP Server** | MCP protocol | Claude, Cursor, SperaxOS |
| **OpenAI Plugin** | OpenAI manifest | ChatGPT, compatible clients |
| **Tool Manifest** | JSON Schema | Any agent framework |
| **API Spec** | OpenAPI 3.x | REST clients, code gen |

## Publishing

### Create Plugin Manifest
```json
{
  "name": "sperax-defi-tools",
  "version": "1.0.0",
  "description": "Sperax DeFi tools — USDs yield, SPA staking, portfolio management",
  "author": "Sperax",
  "license": "MIT",
  "type": "mcp-server",
  "transport": "stdio",
  "command": "npx",
  "args": ["@nirholas/mcp-server"],
  "tools": [
    { "name": "getUSdsYield", "description": "Get current USDs auto-yield APY" },
    { "name": "getSPAPrice", "description": "Get SPA token price" },
    { "name": "getPortfolio", "description": "Get Sperax portfolio overview" }
  ],
  "categories": ["defi", "crypto", "arbitrum"],
  "homepage": "https://app.sperax.io"
}
```

### Publish
```bash
# Install CLI
npm install -g @plugin-delivery/cli

# Login
plugin-delivery login

# Publish
plugin-delivery publish ./manifest.json
```

## Discovery

### Search
```bash
# CLI search
plugin-delivery search "defi yield"

# API search
curl https://api.plugin.delivery/v1/search?q=defi%20yield&type=mcp-server
```

### Browse by Category
| Category | Count | Examples |
|----------|-------|---------|
| **DeFi** | 150+ | Sperax, Aave, Uniswap tools |
| **Market Data** | 80+ | CoinGecko, DeFi Llama |
| **Trading** | 60+ | DEX aggregators, order books |
| **Social** | 40+ | Twitter/X analysis, sentiment |
| **Security** | 30+ | Contract scanners, audit tools |
| **Research** | 25+ | On-chain analytics, VC reports |
| **Productivity** | 100+ | Notes, tasks, code tools |

## Installation

### Claude Desktop
```bash
plugin-delivery install sperax-defi-tools --target claude-desktop
# Automatically updates claude_desktop_config.json
```

### Cursor
```bash
plugin-delivery install sperax-defi-tools --target cursor
```

### SperaxOS
Installed through the SperaxOS skill marketplace UI or via CLI:
```bash
plugin-delivery install sperax-defi-tools --target sperax
```

## Version Management

```bash
# Install specific version
plugin-delivery install sperax-defi-tools@1.2.0

# Update all plugins
plugin-delivery update

# Check for updates
plugin-delivery outdated
```

## Security Scanning

Every published plugin is automatically scanned for:
- Malicious code patterns
- Credential harvesting
- Unauthorized network access
- Dependency vulnerabilities
- License compliance

```
Security Score: A+
├── No malicious patterns detected
├── All dependencies audited
├── License: MIT (compatible)
└── Last scanned: 2 hours ago
```

## Links

- Website: https://plugin.delivery
- GitHub: https://github.com/nirholas/plugin.delivery
- API Docs: https://api.plugin.delivery/docs
- Sperax: https://app.sperax.io
