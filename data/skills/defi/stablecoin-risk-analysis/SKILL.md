---
name: stablecoin-risk-analysis
description: Evaluate stablecoin safety by analyzing peg mechanisms, reserve composition, audit transparency, regulatory exposure, and depegging history to assess holding and usage risk.
license: MIT
metadata:
  category: defi
  difficulty: advanced
  author: sperax-team
  tags: [defi, stablecoin, risk, peg, reserves]
---

# Stablecoin Risk Analysis

## When to use this skill

Use when the user asks about:
- Whether a specific stablecoin is safe to hold
- Comparing stablecoin risk profiles
- Understanding stablecoin peg mechanisms
- Evaluating reserve backing and transparency
- Assessing depegging risk for portfolio decisions

## Analysis Framework

### 1. Stablecoin Classification

Determine the peg mechanism type:
- **Fiat-backed (custodial)**: USDC, USDT — backed by off-chain reserves
- **Crypto-backed (overcollateralized)**: DAI, LUSD — backed by on-chain crypto
- **Algorithmic**: FRAX (partial), UST (failed) — stability via algorithmic controls
- **RWA-backed**: Backed by real-world assets like treasuries
- **Hybrid**: Combination of above mechanisms

Each type has fundamentally different risk profiles.

### 2. Reserve Analysis (Fiat-backed)

For custodially-backed stablecoins:
- **Reserve composition**: Cash, T-bills, commercial paper, repo, other
- **Reserve ratio**: Total reserves / total supply (must be >= 1.0)
- **Attestation frequency**: Monthly, quarterly? By which firm?
- **Real-time proof of reserves**: On-chain attestation available?
- **Counterparty risk**: Which banks hold custody? Diversification?
- **Redemption mechanism**: Can users redeem 1:1? Minimum amount? Delays?

### 3. Collateral Analysis (Crypto-backed)

For overcollateralized stablecoins:
- **Collateral ratio**: Current and minimum (e.g., 150% for DAI)
- **Collateral types accepted**: ETH, wBTC, stETH, other
- **Liquidation mechanism**: How are underwater positions liquidated?
- **Oracle dependency**: Which price feeds? Latency?
- **Governance risk**: Can parameters be changed rapidly?
- **Stress test**: What happens if collateral drops 50% in 1 hour?

### 4. Peg Stability History

Review historical peg performance:
- **Maximum depeg event**: Worst-case deviation from $1.00 and duration
- **Depeg frequency**: How often has it traded below $0.995 or above $1.005?
- **Recovery time**: How quickly did peg restore after deviations?
- **Current premium/discount**: Is it trading at exactly $1.00 now?
- **DEX vs CEX pricing**: Any persistent arbitrage gaps?

### 5. Risk Matrix

| Risk Category | Rating (1-5) | Details |
|--------------|-------------|---------|
| Peg stability | | Historical track record |
| Reserve transparency | | Audit quality and frequency |
| Counterparty risk | | Banking and custodian dependencies |
| Regulatory risk | | Jurisdictional exposure, sanctions compliance |
| Smart contract risk | | Audit status, upgrade mechanisms |
| Censorship risk | | Can the issuer freeze/blacklist addresses? |
| Liquidity risk | | Can you exit large positions without slippage? |
| Systemic risk | | Contagion potential from interconnected protocols |

### 6. Regulatory Exposure

Assess regulatory dimensions:
- Issuer jurisdiction and regulatory status
- Compliance with MiCA, stablecoin-specific regulations
- History of regulatory actions against the issuer
- Blacklisting/freezing capability and past usage
- KYC/AML requirements for direct redemption

### 7. Output Format

- **Stablecoin**: Name and ticker
- **Type**: Mechanism classification
- **Market cap**: Current and trend
- **Peg rating**: Excellent / Good / Fair / Poor
- **Reserve rating**: Fully transparent / Adequate / Opaque / Concerning
- **Overall risk**: Low / Medium / High / Critical
- **Suitable for**: Long-term holding / Short-term trading / DeFi collateral / Avoid
- **Key risks**: Top 3 specific risks for this stablecoin
- **Alternatives**: Suggest lower-risk alternatives if risk is elevated
