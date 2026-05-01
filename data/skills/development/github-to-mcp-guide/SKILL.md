---
name: github-to-mcp-guide
description: Guide to converting GitHub repositories into MCP servers automatically. Extract tools from OpenAPI, GraphQL, and REST APIs for Claude Desktop, Cursor, Windsurf, Cline, and VS Code. AI-powered code generation creates type-safe TypeScript/Python MCP servers. Zero config — just paste a repo URL.
license: MIT
metadata:
  category: development
  difficulty: intermediate
  author: nich
  tags: [development, github-to-mcp-guide]
---

# GitHub-to-MCP Conversion Guide

Convert any GitHub repository into an MCP server automatically. The tool analyzes the repo's API surface (OpenAPI specs, GraphQL schemas, REST endpoints) and generates a working MCP server with type-safe tools.

## How It Works

```
GitHub Repo URL
    │
    ▼
1. Clone & analyze repo
    │
    ▼
2. Detect API surface
   ├── OpenAPI/Swagger specs
   ├── GraphQL schemas
   ├── REST route definitions
   └── Function exports
    │
    ▼
3. Generate MCP server
   ├── TypeScript or Python
   ├── Type-safe tool definitions
   ├── Parameter validation
   └── Error handling
    │
    ▼
4. Ready-to-use MCP server
```

## Quick Start

```bash
npx github-to-mcp https://github.com/owner/repo
```

This generates a ready-to-use MCP server in `./mcp-output/`.

## Supported API Formats

| Format | Detection | Example |
|--------|-----------|---------|
| **OpenAPI 3.x** | `openapi.json`, `swagger.yaml` | REST APIs with full schema |
| **GraphQL** | `schema.graphql`, introspection | Query/mutation → tools |
| **Express/Fastify** | Route scanning | `app.get('/api/...')` → tools |
| **Next.js API** | Route file detection | `app/api/*/route.ts` → tools |
| **Function exports** | Named export analysis | `export function doThing()` → tools |

## Output Options

### TypeScript MCP Server
```bash
github-to-mcp https://github.com/owner/repo --lang typescript
```
Generates a Node.js MCP server with full TypeScript types.

### Python MCP Server
```bash
github-to-mcp https://github.com/owner/repo --lang python
```
Generates a Python MCP server using the official MCP SDK.

## AI-Powered Generation

When the API surface is ambiguous, the tool uses AI (GPT-4 or Claude) to:
- Infer parameter types from usage patterns
- Generate meaningful tool descriptions
- Create example inputs for each tool
- Handle edge cases in API design

## Use Cases

### Turn a DeFi Protocol into MCP Tools
```bash
github-to-mcp https://github.com/aave/aave-v3-core
# → Generates MCP tools for supply, borrow, repay, liquidate, etc.
```

### Convert a Data API
```bash
github-to-mcp https://github.com/nirholas/crypto-data-aggregator
# → Generates MCP tools for price queries, portfolio tracking, alerts
```

### Make Internal Tools AI-Accessible
```bash
github-to-mcp https://github.com/your-company/internal-api
# → Your internal API is now accessible to AI agents
```

## Integration with SperaxOS

github-to-mcp is particularly useful for the SperaxOS ecosystem:
- Convert DeFi protocol repos into MCP tools
- Auto-generate tool manifests for the skill marketplace
- Create agent tools from any Sperax ecosystem repo

## Links

- GitHub: https://github.com/nirholas/github-to-mcp
- MCP Specification: https://modelcontextprotocol.io
- SperaxOS: https://github.com/nirholas/sperax
