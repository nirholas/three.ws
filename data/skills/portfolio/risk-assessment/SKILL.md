---
name: risk-assessment
description: Evaluate overall portfolio risk by analyzing concentration, correlation, volatility exposure, leverage, and protocol dependencies to build a comprehensive risk profile.
license: MIT
metadata:
  category: portfolio
  difficulty: advanced
  author: sperax-team
  tags: [portfolio, risk, assessment, volatility, diversification]
---

# Portfolio Risk Assessment

## When to use this skill

Use when the user asks about:
- Understanding their portfolio's overall risk level
- Identifying hidden risks or correlations
- Stress-testing their portfolio against market scenarios
- Reducing portfolio risk without sacrificing too much upside
- Evaluating whether their risk exposure matches their tolerance

## Risk Assessment Framework

### 1. Concentration Risk

Analyze portfolio distribution:
- **Single-asset concentration**: Any position > 25% of portfolio is high concentration risk
- **Sector concentration**: Total exposure to a single sector (e.g., all DeFi tokens) shouldn't exceed 40%
- **Chain concentration**: Everything on one chain means single-point-of-failure risk (bridge hack, chain halt)
- **Herfindahl Index**: Calculate HHI = sum of squared weights. Below 0.15 = diversified, above 0.25 = concentrated

| Risk Level | Characteristic |
|-----------|----------------|
| Low | No single asset > 15%, no sector > 30%, 3+ chains |
| Medium | One asset 15-25%, sector up to 40%, 2+ chains |
| High | One asset > 25%, sector > 40%, single chain |
| Critical | One asset > 50%, or all in one protocol |

### 2. Correlation Analysis

Assess how positions move together:
- **High correlation cluster**: BTC, ETH, and most alts are highly correlated in drawdowns (correlation 0.7-0.95 during crashes)
- **Diversification reality**: Holding 10 different altcoins does NOT provide meaningful diversification if they all drop 60% together
- **True diversification assets**: Stablecoins, potentially BTC (lower beta during moderate corrections)
- **Negative correlation**: Stablecoins and short positions provide true hedge, but at a carry cost
- **Correlation increases in crisis**: Diversification benefits shrink exactly when you need them most

### 3. Volatility Risk Profile

Quantify the portfolio's volatility exposure:
- **Weighted average volatility**: Sum of (position weight * asset 30d annualized volatility)
- **Maximum drawdown exposure**: Estimate worst-case based on historical max drawdowns of each asset
- **$Value at Risk**: At 95% confidence over 24h, how much could the portfolio lose?
- **Beta to BTC**: How much does the portfolio move per 1% BTC move? Beta > 1.5 is aggressive

### 4. Leverage and Liquidation Risk

If the portfolio includes leveraged positions:
- **Total leverage ratio**: Sum of all positions / actual equity deployed
- **Liquidation prices**: For each leveraged position, what price triggers liquidation?
- **Aggregate liquidation buffer**: Minimum percentage drop across all positions before any liquidation fires
- **Cross-margin risk**: If positions share collateral, one liquidation can cascade
- **Funding rate exposure**: Net funding costs or earnings across perpetual positions

### 5. Protocol and Smart Contract Risk

Assess DeFi-specific risks:
- **Protocol diversification**: Don't put > 20% in any single protocol
- **Audit status**: List protocols used and their audit history
- **Composability risk**: Complex strategies stacking multiple protocols multiply risk (a bug in any layer fails the whole stack)
- **Oracle dependency**: Which oracle do your DeFi positions rely on? Single oracle failure cascades
- **Bridge exposure**: Funds currently on bridges or bridged chains

### 6. Stress Test Scenarios

Model portfolio impact under specific scenarios:

| Scenario | BTC Impact | ETH Impact | Alt Impact | Portfolio |
|----------|-----------|-----------|-----------|-----------|
| 2022-style bear (gradual) | -65% | -70% | -85% | ? |
| Flash crash (24h) | -30% | -35% | -50% | ? |
| Stablecoin depeg | 0% | -10% | -15% | ? |
| Smart contract exploit | 0% | 0% | -100% (affected) | ? |
| Regulatory crackdown | -20% | -25% | -40% | ? |

Calculate the dollar impact for each scenario using actual portfolio weights.

### 7. Risk Score Card

| Risk Category | Score (1-10) | Weight | Weighted Score |
|--------------|-------------|--------|----------------|
| Concentration | | 25% | |
| Correlation | | 20% | |
| Volatility | | 20% | |
| Leverage | | 15% | |
| Protocol/Smart contract | | 10% | |
| Liquidity | | 10% | |
| **Overall Risk Score** | | | **X / 10** |

### 8. Output Format

- **Overall risk level**: Conservative / Moderate / Aggressive / Reckless
- **Risk score**: X / 10 (higher = more risk)
- **Top 3 risks**: Most critical vulnerabilities in the portfolio
- **Worst-case scenario**: Dollar loss in a severe downturn
- **Risk-adjusted improvements**: 3 specific changes to reduce risk while maintaining exposure
- **Diversification grade**: A through F
- **Leverage assessment**: None / Modest / Elevated / Dangerous
- **Action items**: Prioritized risk reduction steps
