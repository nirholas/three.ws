---
name: rug-pull-detection
description: Identify potential rug pull and scam indicators in crypto projects by analyzing contract code, team behavior, liquidity locks, and tokenomics red flags before investing.
license: MIT
metadata:
  category: security
  difficulty: intermediate
  author: sperax-team
  tags: [security, rug-pull, scam, detection, due-diligence]
---

# Rug Pull Detection

## When to use this skill

Use when the user asks about:
- Whether a new token or project might be a scam
- Red flags to look for in a new project
- Evaluating the legitimacy of a low-cap or new token
- Checking if liquidity is locked
- Assessing contract ownership risks

## Detection Framework

### 1. Contract Code Red Flags

Analyze the smart contract for dangerous functions:

| Red Flag | What It Means | Severity |
|----------|--------------|----------|
| Unverified source code | Cannot review what the contract does | Critical |
| Owner can mint unlimited tokens | Unlimited dilution or sell pressure | Critical |
| Hidden fees on transfer | Tax can be set to 99% trapping funds | Critical |
| Blacklist function | Owner can prevent specific wallets from selling | High |
| Proxy with no timelock | Owner can swap contract logic instantly | High |
| Whitelisted trading | Only approved wallets can sell | Critical |
| Max transaction bypassed for owner | Owner can dump while others are limited | High |
| Hardcoded router/pair addresses | Legitimate but check for hidden logic | Medium |

Specific code patterns to check:
- `onlyOwner` functions that modify fees, max transaction, or trading status
- Functions that can disable selling or set transfer tax above 10%
- Hidden `transfer` overrides that apply different rules to different addresses
- Self-destruct or selfdestruct capability

### 2. Liquidity Analysis

Evaluate the safety of the trading pool:
- **Liquidity locked**: Is LP locked via a reputable locker (Unicrypt, Team.Finance, PinkLock)?
- **Lock duration**: Minimum 6 months for moderate trust, 12+ months for higher trust
- **Lock amount**: What percentage of total LP is locked? Should be >80%
- **LP token holder**: If LP is not locked, who holds it? Single wallet = high risk
- **Liquidity depth**: Very thin liquidity relative to market cap means easy manipulation
- **Honeypot check**: Can you actually sell the token? Test with small amounts

### 3. Team and Social Red Flags

Assess the human element:
- **Anonymous team**: Not inherently bad, but increases risk — are they building reputation?
- **Copied website**: Is the site a clone of another project? Check Wayback Machine
- **Fake social proof**: Bought followers, bot engagement patterns
- **Unrealistic promises**: "1000x guaranteed", "risk-free returns", "replacing Bitcoin"
- **Pressure tactics**: "Buy now before it's too late", artificial urgency
- **No clear product**: Token launched without a working product or even a coherent roadmap
- **Previous projects**: Has the team launched and abandoned previous tokens?

### 4. Tokenomics Red Flags

Check the token distribution:
- **Creator wallet holds >20%** of supply (non-locked) — dump risk
- **Top 10 wallets hold >50%** of supply — concentration risk
- **Hidden wallets**: Multiple wallets controlled by the same entity (cluster analysis)
- **No vesting on team tokens**: Can sell immediately at any time
- **Extremely high buy/sell tax**: Taxes above 5% each way are suspicious
- **Tax changes**: Can the owner change tax rates after launch?
- **Recent large transfers**: Team wallets recently moved to exchanges

### 5. Quick Assessment Checklist

Run through this checklist for rapid evaluation:

- [ ] Source code is verified on block explorer
- [ ] No mint function accessible by owner
- [ ] No blacklist or trading pause function
- [ ] Liquidity is locked for 6+ months
- [ ] Top 10 holders own < 40% of supply
- [ ] Team wallet tokens are vested
- [ ] Tax/fee is < 5% and cannot be changed
- [ ] Token has been live for > 30 days
- [ ] Active development (GitHub commits in last 30 days)
- [ ] Community is organic (real discussions, not just price talk)
- [ ] At least 500 unique holders
- [ ] Listed on at least one reputable aggregator (CoinGecko, etc.)

Score: Count of passing checks out of 12
- 10-12: Lower risk (not risk-free)
- 7-9: Moderate risk — proceed with caution
- 4-6: High risk — likely avoid
- 0-3: Extreme risk — almost certainly a scam

### 6. Output Format

- **Token**: Name, contract address, chain
- **Scam indicators found**: List with severity
- **Liquidity status**: Locked / Unlocked / Partial — with details
- **Contract risk**: Safe / Moderate risk / Dangerous / Do not touch
- **Distribution risk**: Fair / Concentrated / Extremely concentrated
- **Social signals**: Legitimate / Suspicious / Clear scam indicators
- **Overall verdict**: Appears legitimate / Proceed with extreme caution / Avoid
- **Recommendation**: If borderlines, suggest maximum allocation (tiny speculative position only)
- **Disclaimer**: This analysis reduces but does not eliminate risk. Never invest more than you can afford to lose in unproven projects.
