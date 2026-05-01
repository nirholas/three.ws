---
name: lending-protocol-comparison
description: Compare DeFi lending and borrowing protocols by analyzing interest rates, collateral requirements, liquidation mechanics, and risk parameters to find optimal lending or borrowing venues.
license: MIT
metadata:
  category: defi
  difficulty: intermediate
  author: sperax-team
  tags: [defi, lending, borrowing, aave, compound, interest]
---

# Lending Protocol Comparison

## When to use this skill

Use when the user asks about:
- Where to lend or borrow a specific asset
- Comparing interest rates across lending protocols
- Understanding liquidation risks and collateral ratios
- Evaluating lending protocol safety
- Optimizing a lending/borrowing position

## Comparison Framework

### 1. Protocol Inventory

For each protocol under comparison, gather:
- Protocol name, version, and chain deployment
- Total supplied and total borrowed for the target asset
- Utilization rate and rate model type (linear, kinked, or dynamic)
- Governance token and incentive status

### 2. Supply Rate Analysis

Compare supply-side economics:
- **Base supply APY** — the rate paid to lenders from borrower interest
- **Incentive APY** — any additional token rewards for supplying
- **Net supply APY** — combined effective return
- **Rate stability** — how much has the rate fluctuated over 7d/30d?
- **Utilization sensitivity** — at what utilization does the rate spike?

### 3. Borrow Rate Analysis

Compare borrow-side costs:
- **Variable borrow APR** — current and 30d average
- **Stable borrow APR** — if available, and conditions for rebalancing
- **Rate model kink point** — the utilization threshold where rates jump
- **Effective borrowing cost** after any incentive offsets

### 4. Collateral Parameters

For each protocol, document:
- **Loan-to-Value (LTV)** — maximum borrowing power per collateral unit
- **Liquidation threshold** — the LTV at which liquidation triggers
- **Liquidation penalty** — the bonus liquidators receive (user's loss)
- **Collateral types accepted** — which assets can be used as collateral
- **Isolation mode** — is the asset in isolation with debt ceilings?
- **E-mode** — are there efficiency modes for correlated assets?

### 5. Risk Assessment

| Factor | Evaluation |
|--------|------------|
| Protocol audit history | Number, recency, and firms |
| Bug bounty size | Indicates confidence in security |
| Oracle mechanism | Chainlink, TWAP, custom? Freshness? |
| Governance timelock | Delay before parameter changes take effect |
| Bad debt history | Any past insolvency events? |
| Supply caps | Are there deposit limits? |
| Borrow caps | Are there borrowing limits? |

### 6. Liquidation Scenario Modeling

For the user's intended position:
- Calculate the liquidation price given their collateral and debt
- Estimate the buffer (current price vs liquidation price as percentage)
- Model what happens if collateral drops 20%, 40%, 60%
- Recommend a safe health factor target (suggest 1.5+ for volatile assets, 1.2+ for stablecoins)

### 7. Output Format

Present a comparison table and recommendation:

| Metric | Protocol A | Protocol B | Protocol C |
|--------|-----------|-----------|-----------|
| Supply APY | X% | Y% | Z% |
| Borrow APR | X% | Y% | Z% |
| LTV | X% | Y% | Z% |
| Liquidation threshold | X% | Y% | Z% |
| Liquidation penalty | X% | Y% | Z% |
| Audit status | ... | ... | ... |

- **Best for lending**: Protocol recommendation with reasoning
- **Best for borrowing**: Protocol recommendation with reasoning
- **Risk-adjusted pick**: Considering security, rate stability, and terms
- **Position recommendations**: Suggested health factor and monitoring frequency
