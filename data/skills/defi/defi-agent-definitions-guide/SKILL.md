---
name: defi-agent-definitions-guide
description: Comprehensive glossary and typology of DeFi AI agents — 80+ agent types categorized by function. Includes taxonomy tables, capability matrices, agent composition patterns, and real-world examples. A reference for anyone building or evaluating DeFi agents.
license: MIT
metadata:
  category: defi
  difficulty: beginner
  author: nich
  tags: [defi, defi-agent-definitions-guide]
---

# DeFi Agent Definitions Guide

A comprehensive glossary and typology of 80+ DeFi AI agent types. Use this reference when designing, building, evaluating, or categorizing AI agents for decentralized finance.

## Agent Categories

| Category | # Types | Purpose |
|----------|---------|---------|
| **Trading Agents** | 12 | Execute trades, arbitrage, market-making |
| **Yield Agents** | 10 | Find and optimize yield across protocols |
| **Risk Agents** | 8 | Monitor and mitigate risk |
| **Portfolio Agents** | 8 | Track and rebalance portfolios |
| **Data Agents** | 10 | Aggregate and analyze on-chain data |
| **Social Agents** | 6 | Monitor social signals and sentiment |
| **Security Agents** | 8 | Audit contracts, detect exploits |
| **Infrastructure Agents** | 6 | Node management, gas optimization |
| **Governance Agents** | 5 | Proposal monitoring, vote delegation |
| **Research Agents** | 7 | Protocol analysis, alpha discovery |

## Trading Agents

| Agent Type | Description | Complexity |
|-----------|-------------|-----------|
| **Swap Agent** | Executes token swaps via DEX aggregators | Low |
| **Arbitrage Agent** | Finds price discrepancies across DEXes | High |
| **Market Maker Agent** | Provides liquidity and manages spreads | High |
| **Grid Bot Agent** | Trades within price ranges (grid strategy) | Medium |
| **DCA Agent** | Dollar cost averaging on schedule | Low |
| **Limit Order Agent** | Places and manages limit orders | Medium |
| **MEV Agent** | Extracts MEV (frontrunning, sandwich) | Very High |
| **MEV Shield Agent** | Protects users from MEV extraction | Medium |
| **Sniper Agent** | Buys new token listings instantly | High |
| **Copy Trade Agent** | Mirrors whale wallet transactions | Medium |
| **Momentum Agent** | Trades based on price momentum signals | Medium |
| **Mean Reversion Agent** | Trades reversions to moving averages | Medium |

## Yield Agents

| Agent Type | Description | Complexity |
|-----------|-------------|-----------|
| **Yield Optimizer** | Finds highest APY across protocols | Medium |
| **Auto-Compound Agent** | Reinvests farming rewards | Low |
| **Vault Manager** | Manages ERC-4626 vault strategies | High |
| **LP Position Agent** | Manages liquidity pool positions | Medium |
| **IL Calculator Agent** | Monitors impermanent loss | Low |
| **Yield Farmer** | Deposits into farming/staking programs | Medium |
| **Stablecoin Yield Agent** | Optimizes yield on stablecoins (USDs, USDC) | Medium |
| **Leveraged Yield Agent** | Uses loops for leveraged yield | High |
| **Points Farmer** | Farms protocol points/airdrop eligibility | Medium |
| **Liquidity Migration Agent** | Moves liquidity to better pools | Medium |

## Risk Agents

| Agent Type | Description |
|-----------|-------------|
| **Protocol Risk Scorer** | Rates protocol safety (audits, TVL, team) |
| **Liquidation Monitor** | Watches positions approaching liquidation |
| **Health Factor Agent** | Maintains lending health factors |
| **De-peg Monitor** | Detects stablecoin de-peg events |
| **Oracle Monitor** | Watches for oracle manipulation |
| **Exposure Tracker** | Calculates cross-protocol exposure |
| **Insurance Agent** | Manages DeFi insurance coverage |
| **Rugpull Detector** | Analyzes contracts for rugpull patterns |

## Agent Composition Patterns

### Single Agent
One agent handles one task end-to-end.
```
User → Swap Agent → DEX → Result
```

### Agent Chain
Sequential agents form a pipeline.
```
User → Research Agent → Risk Agent → Trading Agent → Result
```

### Agent Group
Multiple agents collaborate on a complex task.
```
User → Orchestrator
         ├── Data Agent (market prices)
         ├── Risk Agent (safety check)
         ├── Yield Agent (find opportunities)
         └── Trading Agent (execute)
```

### Autonomous Agent
Self-directed agents with continuous loops.
```
Loop:
  Monitor → Analyze → Decide → Execute → Log → Sleep → Repeat
```

## Sperax Agent Examples

| Agent | Type | Description |
|-------|------|-------------|
| **USDs Yield Agent** | Stablecoin Yield | Hold USDs on Arbitrum, earn 5-10% auto-yield |
| **SPA Staking Agent** | Yield Farmer | Stake SPA → veSPA for boosted rewards |
| **Sperax Farm Agent** | LP Position | Manage Demeter farming positions |
| **Portfolio Agent** | Portfolio Tracker | Track SPA, USDs, veSPA, Plutus positions |

## ERC-8004 Agents

The ERC-8004 standard enables trustless DeFi agents:
- On-chain registration as NFTs
- Reputation scoring
- Decentralized identity
- Agent-to-agent communication

## Links

- GitHub: https://github.com/nirholas/defi-agent-definitions
- Sperax Agent Marketplace: https://app.sperax.io/agents
- ERC-8004: https://eips.ethereum.org/EIPS/eip-8004
