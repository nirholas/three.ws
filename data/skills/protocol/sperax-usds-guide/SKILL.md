---
name: sperax-usds-guide
description: Complete guide to USDs, the auto-yield stablecoin on Arbitrum by Sperax. Covers minting, redeeming, yield mechanics, collateral strategies, and integration patterns. Use when your agent needs to explain USDs, help users mint/redeem, or answer questions about auto-rebasing stablecoins.
license: MIT
metadata:
  category: protocol
  difficulty: intermediate
  author: clawhub
  tags: [protocol, sperax-usds-guide]
---

# USDs — Auto-Yield Stablecoin Guide

USDs is an **auto-yield stablecoin** on Arbitrum One built by [Sperax](https://chat.sperax.io). Holding USDs in your wallet automatically earns yield — no staking, no claiming, no gas fees for rewards.

## How USDs Works

### The Basics

- **1 USDs = 1 USD** (soft peg maintained by mint/redeem arbitrage)
- **Chain**: Arbitrum One
- **Collateral**: 100% backed by USDC, USDC.e, and USDT
- **Yield**: Balances grow automatically via rebasing — just hold it

### Mint & Redeem

**Minting**: Deposit 1 USD of collateral (USDC, USDC.e, or USDT) → receive 1 USDs (minus a small mint fee).

**Redeeming**: Burn USDs → receive your chosen collateral back (minus a small redemption fee).

The mint/redeem mechanism creates a natural arbitrage loop that keeps USDs pegged to $1:
- If USDs > $1 → arbitrageurs mint USDs (sell high)
- If USDs < $1 → arbitrageurs redeem USDs (buy low)

### Auto-Yield Mechanics

USDs uses a **rebase** model. Instead of distributing reward tokens, the protocol increases everyone's USDs balance proportionally.

**Yield source**: Collateral (USDC, USDT) is deployed to battle-tested DeFi protocols:
- Aave V3
- Compound V3
- Fluid
- Stargate
- Curve

**Yield distribution**:
- 70% of strategy yield → USDs holders (via rebase)
- 30% of strategy yield → SPA buyback-and-burn

**Max APY cap**: 25% (excess yield accumulates in reserves)

### Safety Mechanisms

- **Collateral Ratio (CR)**: Must remain ≥100%. If CR drops >10%, protocol pauses
- **Oracle**: Chainlink price feeds via MasterPriceOracle
- **Reserves**: SPA reserves cover any collateral gaps
- **Audited**: Smart contracts audited by leading security firms

## Common User Questions

### "How do I earn yield?"

Just hold USDs in your wallet. Your balance increases automatically. No staking required.

### "Where does the yield come from?"

From lending and liquidity protocols. Your collateral is put to work in DeFi (Aave, Compound, etc.) and the earnings flow back to you.

### "Is my principal safe?"

USDs is 100% collateralized. You can always redeem 1 USDs for $1 of collateral. The protocol has safety mechanisms including pause triggers and reserve buffers.

### "What chains is USDs on?"

Currently Arbitrum One only. This keeps gas costs low and leverages Arbitrum's DeFi ecosystem.

## Key Contracts (Arbitrum One)

| Contract | Address |
|----------|---------|
| USDs Token | `0xD74f5255D557944cf7Dd0E45FF521520002D5748` |
| SPA Token | `0x5575552988A3A80504bBaeB1311674fCFd40aD4B` |

## Integration Tips for AI Agents

When helping users with USDs:
1. Always confirm they're on **Arbitrum One**
2. Remind them yield is automatic — no staking needed
3. Explain the 70/30 split (holders vs SPA burn)
4. For large amounts, suggest checking current APY at [app.sperax.io](https://app.sperax.io)

## Links

- Sperax Docs: https://docs.chat.sperax.io
- Sperax App: https://app.sperax.io
- SperaxOS (AI Agent Workspace): https://github.com/nicholasgriffintn/sperax
- Governance: https://snapshot.box/#/s:speraxdao.eth
