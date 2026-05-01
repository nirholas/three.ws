---
name: yield-farming-analysis
description: Analyze DeFi yield farming opportunities including APY breakdown, risk assessment, smart contract security, and impermanent loss estimation.
license: MIT
metadata:
  category: defi
  difficulty: intermediate
  author: sperax-team
  tags: [defi, yield, farming, apy, liquidity]
---

# Yield Farming Analysis

## When to use this skill

Use when the user asks about:
- Evaluating yield farming opportunities
- Comparing DeFi yields across protocols
- Assessing farming risks and sustainability
- Calculating impermanent loss for a token pair
- Finding the best yield for a given asset or pair

## Analysis Framework

### 1. Opportunity Overview

Gather and present:
- Protocol name, chain, and deployment history
- Pool composition (token pair or single-sided)
- Current APY/APR with base vs incentive breakdown
- TVL (Total Value Locked) and recent trend
- Pool age and historical APY stability over 7d, 30d, 90d

### 2. Yield Breakdown

Decompose the advertised yield into:
- **Base trading fee APY** — derived from actual volume
- **Incentive token APY** — farming reward emissions
- **Compounding frequency** — auto-compound available?
- **Sustainability check** — review emissions schedule, token inflation rate, and runway
- **Comparative yield** — how does this compare to similar pools on other protocols?

### 3. Risk Assessment

Evaluate each factor systematically:

| Risk Factor | What to Check |
|------------|---------------|
| Smart contract audit status | Audited by reputable firm? Multiple audits? |
| Protocol TVL trend | Growing, stable, or declining over 30d? |
| Token emission schedule | Inflationary pressure on reward token? |
| Impermanent loss exposure | High volatility pair or correlated assets? |
| Admin key risk | Multisig with timelock? Or single EOA? |
| Oracle dependency | Which oracle? Redundancy? |
| Liquidity depth | Can the user exit at size without significant slippage? |
| Chain risk | Bridge dependencies, L2 sequencer risk? |

### 4. Impermanent Loss Estimation

For the given token pair, calculate IL scenarios:
- Retrieve current price ratio between the two assets
- Pull historical volatility (30d and 90d)
- Compute correlation coefficient if data available
- Present IL at these price divergence levels:
  - ±10% divergence: ~0.11% IL
  - ±25% divergence: ~0.6% IL
  - ±50% divergence: ~2.0% IL
  - ±100% divergence: ~5.7% IL
- Compare estimated IL against yield to determine net profitability

### 5. Output Format

Provide a structured recommendation:

- **Protocol**: Name and chain
- **Pool**: Token pair and fee tier
- **Current APY**: X% (base Y% + rewards Z%)
- **Verdict**: Strong / Moderate / Weak / Avoid
- **Expected net APY**: After estimated IL
- **Risk level**: Low / Medium / High / Very High
- **Suggested allocation**: Percentage of portfolio (never more than 10% in a single farm)
- **Minimum lock awareness**: Any withdrawal fees or lock periods
- **Exit conditions**: Specific triggers for when to withdraw (reward token drops X%, TVL drops below Y, APY falls below Z)
