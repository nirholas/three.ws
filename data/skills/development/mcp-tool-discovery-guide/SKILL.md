---
name: mcp-tool-discovery-guide
description: Guide to Lyra Tool Discovery — an AI-powered automation toolkit that discovers MCP servers for you. Point it at GitHub, npm, or configure custom discovery sources. Let GPT or Claude analyze APIs and generate ready-to-ship plugin configs. Zero manual work.
license: MIT
metadata:
  category: development
  difficulty: intermediate
  author: nich
  tags: [development, mcp-tool-discovery-guide]
---

# MCP Tool Discovery Guide

Lyra Tool Discovery is an AI-powered toolkit that automatically discovers MCP servers from GitHub, npm, and custom sources. It analyzes APIs and generates ready-to-use plugin configurations.

## How It Works

```
Discovery Sources
  ├── GitHub (repo search, topics, stars)
  ├── npm (package search, mcp keyword)
  ├── MCP Registry (official)
  └── Custom sources (your URLs)
    │
    ▼
AI Analysis (GPT or Claude)
  ├── Analyze repo README
  ├── Detect API surface
  ├── Extract tool signatures
  └── Score quality & relevance
    │
    ▼
Output
  ├── claude_desktop_config.json
  ├── cursor settings
  ├── Plugin manifests
  └── Integration guides
```

## Quick Start

```bash
# Install
npm install -g lyra-tool-discovery

# Discover crypto MCP servers
lyra-discover --topic crypto --min-stars 5

# Discover from specific GitHub user
lyra-discover --github nirholas

# Discover from npm
lyra-discover --npm "mcp server" --category defi
```

## Discovery Modes

### GitHub Discovery
```bash
# Search by topic
lyra-discover --github-topic "mcp,crypto"

# Search by org
lyra-discover --github-org "nirholas"

# Search recently updated
lyra-discover --github-topic mcp --sort updated --since 7d
```

### npm Discovery
```bash
# Search by keyword
lyra-discover --npm "mcp-server"

# Filter by weekly downloads
lyra-discover --npm mcp --min-downloads 100
```

### Registry Discovery
```bash
# Pull from official MCP registry
lyra-discover --registry

# Filter by category
lyra-discover --registry --category "finance"
```

## AI Analysis

For each discovered server, the AI analyzes:

| Aspect | What's Checked |
|--------|---------------|
| **Quality** | Documentation, tests, CI, TypeScript types |
| **Security** | Dependencies, practices, known vulnerabilities |
| **Compatibility** | MCP version, transport type (stdio/SSE) |
| **Functionality** | Number of tools, tool descriptions |
| **Relevance** | Match to your search criteria |

## Output Formats

### Claude Desktop Config
```json
{
  "mcpServers": {
    "sperax-crypto": {
      "command": "npx",
      "args": ["@nirholas/sperax-crypto-mcp"]
    },
    "binance": {
      "command": "npx",
      "args": ["@nirholas/binance-mcp"]
    }
  }
}
```

### Plugin Manifest
```json
{
  "name": "sperax-crypto-mcp",
  "description": "Sperax Protocol MCP",
  "tools": ["mintUSDs", "redeemUSDs", "stakeSPA", ...],
  "quality_score": 0.92,
  "last_updated": "2026-02-20"
}
```

## Batch Discovery

```bash
# Discover all crypto/DeFi MCP servers and output to file
lyra-discover \
  --github-topic "mcp,crypto,defi" \
  --npm "crypto mcp" \
  --registry \
  --output ./discovered-servers.json \
  --format claude-desktop
```

## Use Cases

### SperaxOS Tool Integration
Discover new DeFi tools to integrate into SperaxOS's agent workspace:
```bash
lyra-discover --github-topic "mcp,defi" --min-stars 10 --output ./new-tools.json
```

### Stay Updated
Run weekly to find new MCP servers in the crypto space and evaluate them for integration.

## Links

- GitHub: https://github.com/nirholas/lyra-tool-discovery
- Lyra Registry: https://github.com/nirholas/lyra-registry
- MCP Specification: https://modelcontextprotocol.io
