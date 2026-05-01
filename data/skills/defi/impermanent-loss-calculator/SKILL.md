---
name: impermanent-loss-calculator
description: Calculate and explain impermanent loss for AMM liquidity positions, providing scenario analysis across price movements and comparison against simple holding strategies.
license: MIT
metadata:
  category: defi
  difficulty: beginner
  author: sperax-team
  tags: [defi, impermanent-loss, amm, liquidity, calculator]
---

# Impermanent Loss Calculator

## When to use this skill

Use when the user asks about:
- Calculating impermanent loss for a liquidity position
- Understanding how IL works mechanically
- Comparing LP returns vs holding
- Estimating IL for various price scenarios
- Deciding whether to provide liquidity based on IL risk

## Explanation Framework

### 1. Gather Position Details

Collect from the user:
- **Token pair**: The two assets in the pool (e.g., ETH/USDC)
- **Entry prices**: Price of each token when liquidity was provided
- **Current prices**: Price of each token now (or target scenario prices)
- **Pool type**: Constant product (50/50), concentrated liquidity, or weighted
- **Position value**: Total USD value deposited

### 2. Impermanent Loss Formula

For a standard constant product AMM (50/50 pool):

IL = 2 * sqrt(r) / (1 + r) - 1

Where r = (new price / entry price) of one token relative to the other.

Present IL as both:
- A percentage loss relative to holding
- An absolute dollar amount based on position size

### 3. Scenario Table

Generate a table showing IL at various price divergence levels:

| Price Change | Price Ratio (r) | IL % | IL on $10K Position |
|-------------|-----------------|------|---------------------|
| 0% | 1.00 | 0.00% | $0 |
| +/- 10% | 1.10 or 0.91 | -0.11% | -$11 |
| +/- 25% | 1.25 or 0.80 | -0.60% | -$60 |
| +/- 50% | 1.50 or 0.67 | -2.02% | -$202 |
| +/- 75% | 1.75 or 0.57 | -3.77% | -$377 |
| +/- 100% | 2.00 or 0.50 | -5.72% | -$572 |
| +/- 200% | 3.00 or 0.33 | -13.40% | -$1,340 |
| +/- 400% | 5.00 or 0.20 | -25.46% | -$2,546 |

Customize the table with the user's actual position size.

### 4. Break-Even Analysis

Calculate how much fee income is needed to offset IL:
- Required daily fee income = IL amount / days in position
- Compare against actual or estimated pool fee APR
- Determine the break-even time horizon
- State clearly whether the current fee rate covers the IL

### 5. Concentrated Liquidity Adjustments

For concentrated liquidity positions (Uniswap V3, etc.):
- IL is amplified inversely proportional to the range width
- A position concentrated in a ±10% range has roughly 10x the IL of a full-range position at the same price move
- If price exits the range, the position becomes 100% one token (maximum IL for that range)
- Factor in capital efficiency gains — narrower ranges earn proportionally more fees

### 6. Holding vs LP Comparison

Present a side-by-side comparison:

| Strategy | Value if held | Value as LP | Difference |
|----------|--------------|-------------|------------|
| At entry | $X | $X | $0 |
| At current prices | $Y | $Z | IL amount |

### 7. Output Format

Summarize with:
- **Impermanent loss**: X% ($Y)
- **Fees earned estimate**: $Z
- **Net P&L vs holding**: Positive or negative
- **Recommendation**: Whether fees are likely to outpace IL
- **Risk note**: Remind user that IL becomes permanent loss upon withdrawal if prices have diverged
