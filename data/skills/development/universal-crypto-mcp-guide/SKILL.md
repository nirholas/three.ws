---
name: universal-crypto-mcp-guide
description: Guide to the Universal Crypto MCP server — a multi-chain MCP for AI agents to interact with any blockchain via natural language. Supports swaps, bridges, gas estimation, staking, lending, and more across Ethereum, Arbitrum, Base, Polygon, BSC, and testnets. Plugin architecture for extensibility.
license: MIT
metadata:
  category: development
  difficulty: intermediate
  author: nich
  tags: [development, universal-crypto-mcp-guide]
---

# Universal Crypto MCP Server Guide

The Universal Crypto MCP is a single MCP server that lets AI agents interact with any EVM blockchain through natural language. Instead of configuring separate servers for each chain, this one server handles everything.

## Supported Chains

| Chain | Chain ID | RPC | Status |
|-------|----------|-----|--------|
| Ethereum | 1 | Public/Infura/Alchemy | ✅ |
| Arbitrum One | 42161 | Public | ✅ |
| Base | 8453 | Public | ✅ |
| Polygon | 137 | Public | ✅ |
| BSC | 56 | Public | ✅ |
| Optimism | 10 | Public | ✅ |
| Avalanche | 43114 | Public | ✅ |
| Sepolia Testnet | 11155111 | Public | ✅ |

## Quick Start

```bash
npx @nirholas/universal-crypto-mcp
```

### Claude Desktop Config

```json
{
  "mcpServers": {
    "universal-crypto": {
      "command": "npx",
      "args": ["@nirholas/universal-crypto-mcp"]
    }
  }
}
```

## Core Tools

### Token Operations
| Tool | Description |
|------|-------------|
| `getBalance` | Get native/token balance on any chain |
| `getTokenInfo` | Token metadata (name, symbol, decimals, supply) |
| `transfer` | Transfer tokens between addresses |
| `approve` | Set token spending allowance |

### DeFi Operations
| Tool | Description |
|------|-------------|
| `swap` | Execute token swap via DEX aggregator |
| `getSwapQuote` | Get swap quote without executing |
| `bridge` | Bridge tokens between chains |
| `stake` | Stake tokens in a protocol |
| `lend` | Supply tokens to lending protocol |
| `borrow` | Borrow against collateral |

### Data & Analytics
| Tool | Description |
|------|-------------|
| `getPrice` | Current token price |
| `getGasPrice` | Gas price on target chain |
| `getTransactionHistory` | Address transaction history |
| `getContractInfo` | Smart contract details |

## Plugin Architecture

The Universal Crypto MCP uses a plugin system for extensibility:

```
universal-crypto-mcp/
├── core/           # Base chain interactions
├── plugins/
│   ├── swap/       # DEX aggregation (1inch, 0x, Paraswap)
│   ├── bridge/     # Cross-chain (Across, Stargate, Hop)
│   ├── lending/    # Aave, Compound
│   ├── staking/    # Lido, Rocket Pool
│   └── custom/     # Add your own plugins
```

### Writing a Custom Plugin

```typescript
export const myPlugin = {
  name: 'my-protocol',
  tools: [
    {
      name: 'myTool',
      description: 'Does something useful',
      parameters: { /* JSON Schema */ },
      execute: async (params) => { /* implementation */ }
    }
  ]
};
```

## Natural Language Examples

| User Says | Agent Action |
|-----------|-------------|
| "What's my ETH balance on Arbitrum?" | `getBalance(chain: 'arbitrum', address: '...', token: 'ETH')` |
| "Swap 100 USDC for ETH on Base" | `swap(chain: 'base', from: 'USDC', to: 'ETH', amount: '100')` |
| "Bridge 500 USDT from Ethereum to Arbitrum" | `bridge(from: 'ethereum', to: 'arbitrum', token: 'USDT', amount: '500')` |
| "What's the gas price on Polygon?" | `getGasPrice(chain: 'polygon')` |

## Security Considerations

- Private keys are stored locally, never transmitted
- Transaction simulation before execution (when supported)
- Slippage protection on all swaps
- Gas estimation with safety margin
- Approval amount warnings for unlimited approvals

## Sperax Integration

On Arbitrum, the Universal Crypto MCP can:
- Mint/redeem **Sperax USDs** (auto-yield stablecoin)
- Stake **SPA** tokens and manage **veSPA** positions
- Interact with **Sperax Farms** for LP yield
- Query Sperax protocol analytics

## Links

- GitHub: https://github.com/nirholas/universal-crypto-mcp
- npm: https://www.npmjs.com/package/@nirholas/universal-crypto-mcp
- Sperax: https://app.sperax.io
- MCP Spec: https://modelcontextprotocol.io
