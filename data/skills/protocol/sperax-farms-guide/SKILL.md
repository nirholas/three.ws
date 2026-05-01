---
name: sperax-farms-guide
description: Guide to Sperax Farms — no-code liquidity farming on Arbitrum. Covers farm creation, LP management, supported DEXs (Uniswap V2/V3, Camelot V2/V3, Balancer V2), reward configuration, and farming strategies. Use when explaining liquidity farming, helping users create farms, or managing DeFi positions.
license: MIT
metadata:
  category: protocol
  difficulty: intermediate
  author: clawhub
  tags: [protocol, sperax-farms-guide]
---

# Sperax Farms — Liquidity Farming Guide

Sperax Farms is a **no-code liquidity farming platform** on Arbitrum One. Anyone can create and manage farming incentives for their favorite liquidity pools without writing a single line of code.

## What Are Sperax Farms?

Instead of deploying custom staking contracts, you can use Sperax Farms to:
- Create reward programs for any supported LP pool
- Configure up to 4 reward tokens per farm
- Manage farms via a simple UI
- Support both concentrated (V3) and full-range (V2) positions

## Supported DEXs

| DEX | Pool Types |
|-----|-----------|
| Uniswap V2 | Full-range LP tokens |
| Uniswap V3 | Concentrated liquidity (ERC-721 NFT positions) |
| Camelot V2 | Full-range LP tokens |
| Camelot V3 | Concentrated liquidity positions |
| Balancer V2 | Weighted pool LP tokens |

## Farm Creation Walkthrough

### Step 1: Choose a Pool

Pick the DEX and trading pair you want to incentivize. Popular choices on Arbitrum:
- SPA/ETH on Camelot
- USDs/USDC on Uniswap V3
- USDs/USDT on Balancer

### Step 2: Configure Rewards

- Select up to **4 reward tokens**
- Set reward amounts and duration
- Cost: **100 USDs** to create a farm (one-time fee)
- Extensions: Additional fee per day of extended duration

### Step 3: Fund & Launch

1. Approve reward tokens
2. Deposit reward tokens into the farm contract
3. Farm goes live — LPs can start staking

### Step 4: LPs Stake

Liquidity providers:
1. Add liquidity on the underlying DEX
2. Receive LP token / NFT position
3. Stake in the Sperax Farm
4. Earn rewards proportional to their share

## Farm Economics

### For Farm Creators

- One-time creation fee: 100 USDs
- Extension fee: Per-day rate
- You decide: reward tokens, amounts, duration
- Multiple reward tokens attract more LPs

### For Liquidity Providers

- Earn farm rewards on top of trading fees
- No lock-up — unstake anytime
- Rewards accrue per-second based on your share
- Claim rewards at any time (gas cost is minimal on Arbitrum)

## Strategies

### Bootstrapping Liquidity

New projects can use Sperax Farms to attract initial liquidity:
1. Create a pool on Camelot or Uniswap
2. Set up a Sperax Farm with your project token as reward
3. Use USDs as a paired asset for stablecoin liquidity

### Concentrated Liquidity Optimization (V3)

For Uniswap V3 / Camelot V3:
- Narrower price ranges earn more fees but risk going out-of-range
- Farm rewards are weighted by in-range liquidity
- Active management can significantly boost returns

### Multi-Token Incentives

Use up to 4 reward tokens to create compelling incentive structures:
- Primary: Your project token
- Secondary: USDs (stable yield)
- Tertiary: SPA (governance exposure)
- Quaternary: Another ecosystem token

## Key Contracts (Arbitrum)

| Contract | Address |
|----------|---------|
| FarmRegistry | `0x45bC6B44107837E7aBB21E2CaCbe7612Fce222e0` |

## Agent Tips

When helping users with Sperax Farms:
1. Confirm they have liquidity on a supported DEX first
2. Remind them of the 100 USDs creation fee for new farms
3. For V3 positions: explain concentrated liquidity tradeoffs
4. Check active farms at [app.sperax.io](https://app.sperax.io)

## Links

- Sperax App: https://app.sperax.io
- Sperax Docs: https://docs.chat.sperax.io
- SperaxOS (AI Workspace): https://chat.sperax.io
