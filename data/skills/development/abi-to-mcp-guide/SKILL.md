---
name: abi-to-mcp-guide
description: Guide to UCAI (Universal Contract AI Interface) — the ABI-to-MCP server generator. Point it at any smart contract ABI and get a working MCP server. One command, any contract, Claude speaks it. Supports Uniswap, Aave, ERC20, NFTs, all EVM chains. Security scanner included.
license: MIT
metadata:
  category: development
  difficulty: intermediate
  author: nich
  tags: [development, abi-to-mcp-guide]
---

# UCAI — ABI-to-MCP Server Generator

UCAI (Universal Contract AI Interface) turns any smart contract ABI into a ready-to-use MCP server. One command — any contract on any EVM chain — and your AI agent can interact with it.

## The Concept

```
Smart Contract ABI (JSON)
    │
    ▼
  UCAI CLI
    │
    ▼
MCP Server with tools for every function
    │
    ▼
AI Agent calls contract functions naturally:
  "What's the total supply of this ERC20?"
  "How much can I borrow on Aave?"
```

## Quick Start

### Install

```bash
pip install abi-to-mcp
```

### Generate MCP Server

```bash
# From a verified contract on Etherscan
ucai generate 0xD74f5255D557944cf7Dd0E45FF521520002D5748 --chain arbitrum

# From a local ABI file
ucai generate ./my-contract-abi.json --chain ethereum

# From a well-known protocol
ucai generate uniswap-v3-router --chain ethereum
```

### Use with Claude Desktop

```json
{
  "mcpServers": {
    "my-contract": {
      "command": "ucai",
      "args": ["serve", "0xD74f5255D557944cf7Dd0E45FF521520002D5748", "--chain", "arbitrum"]
    }
  }
}
```

## How It Works

1. **ABI Parsing** — Reads contract ABI (from Etherscan, local file, or known protocol)
2. **Tool Generation** — Creates one MCP tool per contract function
3. **Type Mapping** — Solidity types → JSON Schema types
4. **Read/Write Split** — Read functions (view/pure) are safe; write functions need signing
5. **Documentation** — Auto-generates descriptions from function signatures and NatSpec

### Generated Tool Example

For a function like:
```solidity
function balanceOf(address account) external view returns (uint256)
```

UCAI generates:
```json
{
  "name": "balanceOf",
  "description": "Get the token balance of an account",
  "parameters": {
    "account": { "type": "string", "description": "The account address (address)" }
  }
}
```

## Supported Chains

| Chain | Explorer | Auto-ABI Fetch |
|-------|----------|---------------|
| Ethereum | Etherscan | ✅ |
| Arbitrum | Arbiscan | ✅ |
| Base | Basescan | ✅ |
| Polygon | Polygonscan | ✅ |
| BSC | BscScan | ✅ |
| Optimism | Optimistic Etherscan | ✅ |
| Avalanche | Snowtrace | ✅ |

## Security Scanner

UCAI includes a built-in security scanner that checks:

| Check | What It Does |
|-------|-------------|
| **Reentrancy** | Detects reentrancy vulnerabilities |
| **Unlimited Approvals** | Flags functions requesting unlimited token approvals |
| **Admin Functions** | Identifies privileged/owner-only functions |
| **Proxy Patterns** | Detects upgradeable proxy contracts |
| **Self-Destruct** | Flags contracts with selfdestruct capability |

```bash
ucai scan 0x... --chain ethereum
```

## Web Builder

For non-developers, UCAI provides a web interface at [mcp.ucai.tech](https://mcp.ucai.tech):
1. Paste contract address
2. Select chain
3. Click "Generate"
4. Download MCP server config

## Common Recipes

### ERC-20 Token Tools
```bash
ucai generate 0x... --chain arbitrum
# → balanceOf, totalSupply, transfer, approve, allowance, etc.
```

### Aave V3 Lending
```bash
ucai generate aave-v3-pool --chain arbitrum
# → supply, borrow, repay, withdraw, getUserAccountData, etc.
```

### Sperax USDs
```bash
ucai generate 0xD74f5255D557944cf7Dd0E45FF521520002D5748 --chain arbitrum
# → balanceOf, totalSupply, mint, redeem, getCollateralRatio, etc.
```

## The UCAI Standard

UCAI defines a standard for mapping Solidity ABIs to MCP tool definitions:
- Every `view`/`pure` function → read-only MCP tool
- Every state-changing function → write MCP tool (requires signing)
- Events → subscription tools (where supported)
- Structs → nested JSON Schema objects

## Links

- PyPI: https://pypi.org/project/abi-to-mcp/
- Web Builder: https://mcp.ucai.tech
- GitHub: https://github.com/nirholas/UCAI
- Docs: https://docs.ucai.tech
- Anthropic MCP Registry: https://registry.modelcontextprotocol.io
