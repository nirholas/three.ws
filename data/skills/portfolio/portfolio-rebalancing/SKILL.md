---
name: portfolio-rebalancing
description: Guide portfolio rebalancing decisions by analyzing current allocations against target weights, calculating drift, and recommending trades to restore balance while minimizing costs and tax impact.
license: MIT
metadata:
  category: portfolio
  difficulty: intermediate
  author: sperax-team
  tags: [portfolio, rebalancing, allocation, diversification, strategy]
---

# Portfolio Rebalancing

## When to use this skill

Use when the user asks about:
- Rebalancing their crypto portfolio
- Whether their current allocations are too concentrated
- Setting up a target allocation strategy
- Calculating what trades to make to reach target weights
- Deciding how often to rebalance

## Rebalancing Framework

### 1. Current Portfolio Assessment

Gather and analyze:
- **Holdings list**: Each asset, quantity, and current USD value
- **Current weights**: Each holding as a percentage of total portfolio
- **Total portfolio value**: Sum of all positions
- **Performance since last rebalance**: Per-asset and total
- **Concentration check**: Any single asset > 30% of portfolio is a concentration risk flag

### 2. Target Allocation Design

Help define or review target weights based on risk profile:

**Conservative (lower volatility)**:
- BTC: 40-50%, ETH: 25-30%, Stablecoins: 15-20%, Alts: 5-10%

**Balanced (moderate risk)**:
- BTC: 30-40%, ETH: 20-25%, Large-cap alts: 15-20%, Mid-cap: 10-15%, Stablecoins: 5-10%

**Aggressive (higher risk, higher potential)**:
- BTC: 20-25%, ETH: 15-20%, Large-cap alts: 20-25%, Mid/Small-cap: 20-30%, Stablecoins: 5%

Key constraints:
- No single alt should exceed 10% of portfolio
- Stablecoin allocation provides dry powder for opportunities
- DeFi positions (LP, staking) count toward the underlying asset allocation

### 3. Drift Analysis

Calculate how far each position has drifted from target:

| Asset | Target % | Current % | Drift | Action |
|-------|---------|----------|-------|--------|
| BTC | 35% | 42% | +7% | Trim |
| ETH | 25% | 20% | -5% | Add |
| SOL | 10% | 15% | +5% | Trim |
| Stables | 10% | 3% | -7% | Add |

### 4. Rebalancing Triggers

Recommend a rebalancing approach:
- **Calendar-based**: Rebalance monthly or quarterly on fixed dates
- **Threshold-based**: Rebalance when any position drifts >5% from target (recommended)
- **Hybrid**: Check monthly, only act if drift exceeds threshold
- Avoid daily rebalancing — transaction costs and taxes erode returns

### 5. Trade Calculation

For each rebalancing trade:
- **Direction**: Buy or sell
- **Amount**: Dollar value to trade (target weight * portfolio — current value)
- **Priority**: Execute the largest drifts first
- **Cost awareness**: Factor in exchange fees, gas costs, and slippage
- **Minimum trade size**: Skip trades smaller than $50 — not worth the gas/fees

### 6. Tax and Cost Considerations

- **Tax lots**: When selling, consider which lots have the lowest tax impact (long-term vs short-term gains)
- **Tax-loss harvesting**: If any position is at a loss, selling and rebuying (or buying a correlated asset) captures the loss for tax offset
- **Gas optimization**: Batch trades during low-gas periods; consider L2s if available
- **Net rebalance**: Match buys and sells to minimize total transaction count

### 7. Output Format

- **Portfolio value**: Total current value
- **Largest drift**: Which asset and how far from target
- **Rebalance needed**: Yes / No (based on threshold)
- **Recommended trades**: Ordered list with asset, direction, amount
- **Estimated costs**: Total fees and gas for the rebalance
- **Post-rebalance allocation**: Projected weights after trades
- **Next review date**: When to check again
