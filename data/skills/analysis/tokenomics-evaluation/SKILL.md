---
name: tokenomics-evaluation
description: Evaluate token economic models by analyzing supply mechanics, distribution, utility, value accrual mechanisms, and emission schedules to assess long-term token value sustainability.
license: MIT
metadata:
  category: analysis
  difficulty: advanced
  author: sperax-team
  tags: [analysis, tokenomics, supply, distribution, valuation]
---

# Tokenomics Evaluation

## When to use this skill

Use when the user asks about:
- Evaluating a token's economic model
- Understanding token supply and emission schedules
- Assessing whether tokenomics support long-term value
- Comparing tokenomics across competing projects
- Identifying tokenomics red flags before investing

## Evaluation Framework

### 1. Supply Structure

Map the complete supply picture:
- **Max supply**: Is there a hard cap or infinite supply?
- **Total supply**: All tokens created to date
- **Circulating supply**: Tokens currently in the market
- **Supply ratio**: Circulating / Total — low ratio means significant future dilution
- **Emission schedule**: Plot supply over 1, 2, 5 years
- **Inflation rate**: Annual percentage increase in circulating supply
- **Burn mechanisms**: Any deflationary counters to emissions?

### 2. Distribution Analysis

Assess how tokens are allocated:

| Category | Percentage | Vesting | Concern Level |
|----------|-----------|---------|---------------|
| Team | X% | Y months cliff + Z vest | Normal: 15-20% |
| Investors (seed/private) | X% | Y months cliff + Z vest | Normal: 15-25% |
| Community/Ecosystem | X% | Ongoing distribution | Normal: 30-50% |
| Treasury | X% | Governance-controlled | Normal: 10-20% |
| Public sale | X% | Usually unlocked | Normal: 5-15% |

Red flags:
- Team + investors > 50% of total supply
- Short vesting (< 12 months cliff)
- Large immediate unlock events approaching
- Single wallet holding > 10% of circulating supply (non-exchange)

### 3. Vesting and Unlock Schedule

Create a timeline of major unlock events:
- **Past unlocks**: How has the market reacted to previous unlocks?
- **Upcoming unlocks**: Next 3, 6, 12 months — amounts and recipients
- **Cliff events**: Large one-time unlocks vs gradual linear vesting
- **Sell pressure estimation**: Assume 20-50% of unlocked investor tokens get sold within 30 days
- **Critical dates**: Flag any unlock representing > 5% of circulating supply

### 4. Token Utility Assessment

Evaluate what the token actually does:
- **Governance**: Does holding grant meaningful voting power?
- **Fee payment**: Is the token required for protocol usage? Or optional?
- **Staking**: What incentive exists to stake? Staking rate?
- **Collateral**: Can it be used as collateral in DeFi?
- **Access/membership**: Does it unlock features or tiers?
- **Utility depth score**: How many genuine use cases generate organic demand?

### 5. Value Accrual Analysis

Determine how protocol success translates to token value:
- **Revenue to holders**: Fee-sharing, buyback-and-burn, or ve-model?
- **Revenue data**: Actual protocol revenue (30d, 90d, annualized)
- **P/E or P/S ratio**: Market cap / annualized revenue — compare to peers
- **Token sink strength**: How much net buying pressure does the mechanism create?
- **Reflexivity risk**: Does the token's value depend on its own price? (circular incentives)

### 6. Comparative Tokenomics

Compare against category peers:

| Metric | This Token | Peer A | Peer B |
|--------|-----------|--------|--------|
| FDV / Market Cap ratio | | | |
| Annual inflation | | | |
| Staking yield | | | |
| Revenue / FDV | | | |
| Team allocation | | | |
| Community allocation | | | |

### 7. Tokenomics Scoring

Rate each dimension on a 1-5 scale:
- **Supply design**: Predictable, capped, with healthy emission curve
- **Distribution fairness**: Wide distribution, reasonable team allocation
- **Utility strength**: Multiple genuine use cases driving demand
- **Value accrual**: Clear path from protocol revenue to token value
- **Vesting structure**: Long cliffs, gradual unlock, aligned incentives

### 8. Output Format

- **Token**: Name, ticker, chain
- **Tokenomics grade**: A / B / C / D / F
- **Key strength**: Single best aspect of the tokenomics
- **Key risk**: Single biggest tokenomics concern
- **Upcoming catalysts**: Unlock events or tokenomics changes in next 90 days
- **Inflation outlook**: Current and projected annual inflation
- **Value accrual**: Strong / Moderate / Weak / None
- **Verdict**: Tokenomics support investment / Neutral / Tokenomics are a headwind
