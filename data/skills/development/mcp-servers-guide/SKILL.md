---
name: mcp-servers-guide
description: Comprehensive guide to MCP (Model Context Protocol) servers — the standard for connecting AI agents to tools. Covers architecture, transport types, tool/resource/prompt primitives, security, and how to build, deploy, and discover MCP servers for any use case.
license: MIT
metadata:
  category: development
  difficulty: intermediate
  author: nich
  tags: [development, mcp-servers-guide]
---

# MCP Servers Comprehensive Guide

MCP (Model Context Protocol) is the open standard for connecting AI agents to tools. This guide covers everything from architecture to deployment.

## What Is MCP?

```
AI Agent (Claude, GPT, etc.)
    │
    ▼
MCP Client (built into host app)
    │
    ▼
MCP Server (your tool/service)
    │
    ├── Tools (functions the agent can call)
    ├── Resources (data the agent can read)
    └── Prompts (templates for the agent)
```

## Core Primitives

### Tools
Functions the agent can execute:
```typescript
server.tool('getTokenPrice', {
  description: 'Get the current price of a cryptocurrency',
  parameters: z.object({
    symbol: z.string().describe('Token symbol (e.g., SPA, ETH)'),
    currency: z.string().default('usd').describe('Target currency')
  }),
  handler: async ({ symbol, currency }) => {
    const price = await fetchPrice(symbol, currency);
    return { content: [{ type: 'text', text: `${symbol}: $${price}` }] };
  }
});
```

### Resources
Data the agent can read:
```typescript
server.resource('portfolio', {
  description: 'User DeFi portfolio',
  uri: 'portfolio://current',
  handler: async () => {
    const portfolio = await getPortfolio();
    return { content: [{ type: 'text', text: JSON.stringify(portfolio) }] };
  }
});
```

### Prompts
Templates for the agent:
```typescript
server.prompt('defi-analysis', {
  description: 'Analyze a DeFi protocol',
  arguments: [{ name: 'protocol', description: 'Protocol name' }],
  handler: ({ protocol }) => ({
    messages: [{
      role: 'user',
      content: `Analyze the DeFi protocol "${protocol}" covering TVL, APY, risks, and team.`
    }]
  })
});
```

## Transport Types

| Transport | How It Works | Best For |
|-----------|-------------|---------|
| **stdio** | Command-line process (stdin/stdout) | Local tools, CLI |
| **SSE** | Server-Sent Events over HTTP | Remote servers |
| **Streamable HTTP** | HTTP with streaming | Web services |

### stdio Setup
```json
{
  "mcpServers": {
    "my-tool": {
      "command": "npx",
      "args": ["@my/mcp-server"]
    }
  }
}
```

### SSE Setup
```json
{
  "mcpServers": {
    "my-tool": {
      "url": "https://mcp.example.com/sse"
    }
  }
}
```

## Building an MCP Server

### TypeScript (Recommended)
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({
  name: 'sperax-defi',
  version: '1.0.0',
  description: 'Sperax DeFi tools'
});

// Add tools
server.tool('getUSdsAPY', {
  description: 'Get current USDs auto-yield APY',
  handler: async () => ({
    content: [{ type: 'text', text: 'USDs APY: 7.2%' }]
  })
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
```

### Python
```python
from mcp.server import Server
from mcp.server.stdio import stdio_server

server = Server("sperax-defi")

@server.tool("getUSdsAPY")
async def get_usds_apy():
    """Get current USDs auto-yield APY"""
    return "USDs APY: 7.2%"

async def main():
    async with stdio_server() as (read, write):
        await server.run(read, write)
```

## Security Best Practices

| Practice | Description |
|----------|-------------|
| **Input Validation** | Validate all tool parameters with Zod/schemas |
| **Rate Limiting** | Prevent abuse with per-tool rate limits |
| **API Key Isolation** | Use env vars, never hardcode secrets |
| **Least Privilege** | Each tool gets minimum necessary permissions |
| **Audit Logging** | Log all tool invocations |
| **Output Sanitization** | Never leak internal data in responses |

## Popular MCP Servers

| Server | Tools | Stars |
|--------|-------|-------|
| @nirholas/agenti-mcp | 380+ DeFi tools | 1.1K+ |
| @nirholas/sperax-crypto-mcp | Sperax protocol | 200+ |
| @nirholas/binance-mcp | Exchange trading | 400+ |
| filesystem | Local file access | Built-in |
| brave-search | Web search | Built-in |

## Links

- MCP Spec: https://modelcontextprotocol.io
- SDK (TypeScript): https://github.com/modelcontextprotocol/typescript-sdk
- SDK (Python): https://github.com/modelcontextprotocol/python-sdk
- MCP Servers GitHub: https://github.com/nirholas/mcp-servers
- SperaxOS: https://app.sperax.io
