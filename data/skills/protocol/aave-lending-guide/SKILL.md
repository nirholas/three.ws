---
name: aave-lending-guide
description: Guide to using Aave lending protocol including supply/borrow mechanics, risk parameters, health factor management, flash loans, and efficiency mode strategies.
license: MIT
metadata:
  category: protocol
  difficulty: intermediate
  author: sperax-team
  tags: [protocol, aave, lending, borrowing, flash-loans]
---

# Aave Lending Guide

## When to use this skill

Use when the user asks about:
- How to use Aave for lending or borrowing
- Understanding Aave's risk parameters
- Managing health factor and avoiding liquidation
- Using Aave's E-mode for correlated assets
- Flash loan use cases and mechanics
- Comparing Aave deployments across chains

## Protocol Knowledge

### 1. Aave Core Mechanics

How Aave works:
- **Supply**: Deposit assets to earn interest. Supplied assets can optionally be used as collateral.
- **Borrow**: Use supplied collateral to borrow other assets. Pay variable or stable interest.
- **Interest rates**: Algorithmically determined by supply/demand (utilization rate)
- **aTokens**: When you supply, you receive aTokens (aUSDC, aETH) that accrue interest continuously — your balance goes up over time
- **Debt tokens**: When you borrow, variable debt tokens track your growing debt

### 2. Key Parameters Per Asset

Each asset on Aave has specific risk parameters set by governance:

| Parameter | Meaning | Typical Range |
|-----------|---------|---------------|
| LTV (Loan-to-Value) | Max borrowing power per collateral dollar | 50-85% |
| Liquidation Threshold | Debt/collateral ratio triggering liquidation | 65-90% |
| Liquidation Penalty | Bonus paid to liquidators from collateral | 5-15% |
| Reserve Factor | Percentage of interest going to Aave treasury | 10-30% |
| Supply Cap | Maximum amount that can be supplied | Varies |
| Borrow Cap | Maximum amount that can be borrowed | Varies |

### 3. Health Factor Management

The health factor is the most critical metric for borrowers:

Health Factor = (Collateral * Liquidation Threshold) / Total Debt

- **HF > 2.0**: Safe — significant buffer before liquidation
- **HF 1.5-2.0**: Comfortable — monitor during volatile periods
- **HF 1.1-1.5**: Caution — consider adding collateral or repaying debt
- **HF < 1.1**: Danger — liquidation imminent
- **HF = 1.0**: Liquidation triggered

**To improve health factor**:
- Add more collateral (supply more assets)
- Repay part of the debt
- Swap borrowed asset for one with lower volatility

**To calculate liquidation price**:
Liquidation Price = (Entry Price * Debt) / (Collateral * Liquidation Threshold)

### 4. Efficiency Mode (E-Mode)

E-Mode allows higher capital efficiency for correlated asset pairs:
- **Stablecoin E-Mode**: Borrow stablecoins against stablecoin collateral at 97% LTV
- **ETH correlated E-Mode**: Borrow ETH against stETH/wstETH at 93% LTV
- **Benefit**: Much higher LTV than standard mode for qualifying pairs
- **Risk**: Still subject to depeg risk — if the correlation breaks, liquidation can be sudden
- **Activation**: Select E-Mode category in the Aave dashboard before borrowing

### 5. Interest Rate Mechanics

How rates work:
- **Variable rate**: Changes based on pool utilization — low utilization = low rate, high utilization = high rate
- **Optimal utilization**: Usually around 80% — rates increase steeply above this (kink in the rate curve)
- **Rate strategy**: Check the specific rate strategy contract for slope parameters
- **Monitoring**: Variable rates can change significantly within hours during volatile markets
- **Rate switching**: Users can sometimes switch between variable and stable (if available for the asset)

### 6. Flash Loans

Aave's flash loan functionality:
- **What**: Borrow any amount with no collateral, as long as it's repaid within the same transaction
- **Fee**: 0.05% on V3 (was 0.09% on V2)
- **Use cases**:
  - Arbitrage between DEXs
  - Collateral swaps (change collateral type without closing position)
  - Self-liquidation (repay debt to prevent liquidation penalty)
  - Leveraged position creation (loop supply/borrow in one transaction)
- **Risk**: If the transaction reverts, the entire flash loan fails — no partial execution

### 7. Multi-Chain Deployments

Aave is deployed across multiple chains — each has independent pools and parameters:
- **Ethereum mainnet**: Highest TVL, most assets, highest gas costs
- **Arbitrum**: Lower gas, good liquidity, growing TVL
- **Optimism**: Similar to Arbitrum, OP incentives available
- **Polygon**: Low gas, significant TVL, MATIC incentives
- **Base**: Growing rapidly, low gas costs
- **Avalanche**: Established deployment with AVAX incentives

Choose chain based on: position size (gas vs value ratio), asset availability, and incentives.

### 8. Output Format

When advising on Aave usage:
- **Action**: Supply / Borrow / Repay / Flash loan
- **Chain**: Recommended deployment
- **Asset**: Specific token and current rates
- **Parameters**: LTV, liquidation threshold for the position
- **Health factor**: Current and projected
- **Liquidation price**: If borrowing
- **Risk level**: Safe / Moderate / Risky
- **Optimization tips**: E-Mode applicability, better asset choices
- **Gas estimate**: Expected transaction cost on the chosen chain
