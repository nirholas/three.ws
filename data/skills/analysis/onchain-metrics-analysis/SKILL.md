---
name: onchain-metrics-analysis
description: Analyze on-chain blockchain data including transaction volumes, active addresses, gas usage, whale movements, and network health indicators to derive actionable insights.
license: MIT
metadata:
  category: analysis
  difficulty: advanced
  author: sperax-team
  tags: [analysis, on-chain, metrics, blockchain, data]
---

# On-Chain Metrics Analysis

## When to use this skill

Use when the user asks about:
- On-chain activity for a specific blockchain or token
- Network health and usage trends
- Interpreting on-chain data for investment decisions
- Comparing blockchains by activity metrics
- Detecting accumulation or distribution phases via on-chain signals

## Analysis Framework

### 1. Network Activity Metrics

Assess overall network health:
- **Daily active addresses**: Unique addresses transacting — trend over 7d, 30d, 90d
- **New addresses**: Rate of new wallet creation — proxy for user adoption
- **Transaction count**: Daily transactions and trend; distinguish between value transfers and contract calls
- **Transaction volume (USD)**: Total value moved on-chain
- **Average transaction size**: Large increases may indicate institutional activity
- **Network fees**: Total fees paid — reflects organic demand for blockspace

### 2. Token-Specific Metrics

For individual tokens:
- **Holder count**: Total unique holders and growth rate
- **Holder distribution**: Gini coefficient or top-10 holder concentration percentage
- **Transfer volume**: Token-specific transfer volume and frequency
- **Exchange balance**: Percentage of supply held on exchanges — declining = accumulation
- **Dormancy flow**: Ratio of market cap to annualized dormancy — high values suggest older coins moving (potential distribution)
- **Velocity**: How frequently tokens change hands — high velocity can indicate speculative activity

### 3. Whale and Smart Money Analysis

Track large wallet behavior:
- **Whale wallet threshold**: Define what constitutes a "whale" for this token (top 0.1% holders)
- **Accumulation signals**: Whales moving tokens off exchanges to cold wallets
- **Distribution signals**: Whales moving tokens to exchanges (potential sell prep)
- **Smart money wallets**: Track wallets with historical track record of profitable early entries
- **Large transaction count**: Number of transactions above $100K in 24h

### 4. DeFi-Specific Metrics (if applicable)

For DeFi protocols:
- **Total Value Locked (TVL)**: Current and trend
- **TVL/Market Cap ratio**: Below 1.0 may signal undervaluation
- **Protocol revenue**: Trading fees, interest, liquidation revenue
- **Revenue to token holders**: What percentage of revenue accrues to token value?
- **User count**: Unique addresses interacting with the protocol
- **Retention**: What percentage of users return after 7d, 30d?

### 5. Supply Dynamics

Analyze supply-side factors:
- **Circulating supply vs total supply**: Percentage in circulation
- **Staking rate**: What percentage of supply is staked? Higher = less sell pressure
- **Locked in DeFi**: Supply locked in LP, lending, or vaults
- **Supply on exchanges**: Declining exchange supply historically correlates with price appreciation
- **Realized cap vs market cap**: MVRV ratio — above 3.0 historically overheated for BTC

### 6. Network Comparison Table

When comparing blockchains:

| Metric | Chain A | Chain B | Chain C |
|--------|---------|---------|---------|
| Daily active addresses | | | |
| Daily transactions | | | |
| Avg. tx fee | | | |
| TVL | | | |
| Revenue (30d) | | | |
| Developer count | | | |

### 7. Output Format

- **Network/Token**: Name and chain
- **Activity trend**: Growing / Stable / Declining
- **Key signal**: The single most important on-chain insight
- **Accumulation/Distribution**: Phase assessment with supporting data
- **Health score**: Healthy / Neutral / Concerning
- **Notable observations**: 2-3 specific data points that stand out
- **Data sources**: Which dashboards or APIs the data is referenced from
- **Actionable takeaway**: What this data suggests about price or adoption direction
