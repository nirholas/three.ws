---
name: sperax-mcp-guide
description: Guide to the Sperax Crypto MCP server — enables AI agents to interact with USDs (auto-yield stablecoin), SPA governance, veSPA staking, Demeter yield farms, and Plutus vaults on Arbitrum and BNB Chain. Listed on Anthropic's official MCP Registry.
license: MIT
metadata:
  category: protocol
  difficulty: intermediate
  author: nich
  tags: [protocol, sperax-mcp-guide]
---

# Sperax Crypto MCP Server Guide

The official MCP server for the Sperax Protocol. Listed on Anthropic's MCP Registry, it enables AI agents to interact with the full Sperax ecosystem on Arbitrum and BNB Chain.

## What It Provides

| Protocol | Tools | Description |
|----------|-------|-------------|
| **USDs** | Mint, redeem, balance, APY | Auto-yield stablecoin (8-25% APY) |
| **SPA** | Stake, unstake, balance | Governance token operations |
| **veSPA** | Lock, extend, claim | Vote-escrowed SPA for governance power |
| **Demeter Farms** | Deposit, withdraw, harvest | Liquidity farming on Arbitrum |
| **Plutus** | Browse vaults, deposit, withdraw | Yield vaults on BNB Chain |

## Quick Start

```bash
npx @nirholas/sperax-crypto-mcp
```

### Claude Desktop Config

```json
{
  "mcpServers": {
    "sperax": {
      "command": "npx",
      "args": ["@nirholas/sperax-crypto-mcp"],
      "env": {
        "ARBITRUM_RPC_URL": "https://arb1.arbitrum.io/rpc",
        "BSC_RPC_URL": "https://bsc-dataseed.binance.org"
      }
    }
  }
}
```

## USDs Tools

### Mint USDs
Deposit USDC, USDC.e, or USDT to mint USDs:
```
Tool: mintUSDs
Input: { "collateral": "USDC", "amount": "1000" }
Result: "Minted 999.5 USDs (0.05% mint fee)"
```

### Check USDs APY
```
Tool: getUSDsAPY
Result: { "currentAPY": "12.4%", "maxCap": "25%", "yieldSource": "Aave, Compound, Stargate" }
```

### Redeem USDs
Burn USDs to receive collateral:
```
Tool: redeemUSDs
Input: { "amount": "500", "collateral": "USDC" }
Result: "Redeemed 500 USDs for 499.75 USDC"
```

## SPA & veSPA Tools

### Stake SPA
```
Tool: stakeSPA
Input: { "amount": "10000", "lockDuration": "365" }
Result: "Staked 10,000 SPA → received veSPA with 365-day lock"
```

### veSPA Governance Power
```
Tool: getVeSPABalance
Result: {
  "veSPA": "8500",
  "lockExpiry": "2027-01-15",
  "votingPower": "2.3%",
  "weeklyRewards": "125 SPA"
}
```

## Demeter Farms

### List Available Farms
```
Tool: listFarms
Result: [
  { "pair": "USDs/USDC", "apr": "15.2%", "tvl": "$4.2M" },
  { "pair": "SPA/ETH", "apr": "42.8%", "tvl": "$1.8M" },
  { "pair": "USDs/FRAX", "apr": "18.5%", "tvl": "$2.1M" }
]
```

### Deposit to Farm
```
Tool: depositToFarm
Input: { "farm": "USDs/USDC", "amount": "5000" }
Result: "Deposited 5,000 LP tokens to USDs/USDC farm"
```

## Plutus Vaults (BNB Chain)

| Vault | Strategy | Target APY |
|-------|----------|-----------|
| **plvHEDGE** | Delta-neutral hedging | 10-20% |
| **plvLOOP** | Leveraged looping | 15-30% |
| **plvDOLO** | Dollar-denominated | 8-15% |

## Key Contract Addresses

### Arbitrum One
| Contract | Address |
|----------|---------|
| USDs Token | `0xD74f5255D557944cf7Dd0E45FF521520002D5748` |
| SPA Token | `0x5575552988A3A80504bBaeB1311674fCFd40aD4B` |
| veSPA | `0x2e2071180682Ce6C247B1eF93d382D509F5F6a17` |

## Agent Workflow Examples

### Yield Optimizer
1. Agent checks current USDs APY
2. Compares with farm APYs
3. Recommends optimal allocation (hold USDs vs farm)
4. Executes approved rebalancing

### Governance Participant
1. Agent monitors active proposals
2. Summarizes proposals for user
3. Calculates voting power from veSPA
4. Casts vote when instructed

## Links

- GitHub: https://github.com/nirholas/sperax-crypto-mcp
- Anthropic MCP Registry: https://registry.modelcontextprotocol.io
- Sperax Docs: https://docs.chat.sperax.io
- Sperax App: https://app.sperax.io
