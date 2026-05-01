---
name: ethereum-gas-optimization
description: Optimize Ethereum gas usage by understanding gas mechanics, timing transactions for low-fee periods, batching operations, and selecting appropriate L2 solutions for different use cases.
license: MIT
metadata:
  category: protocol
  difficulty: intermediate
  author: sperax-team
  tags: [protocol, ethereum, gas, optimization, l2, transactions]
---

# Ethereum Gas Optimization

## When to use this skill

Use when the user asks about:
- Reducing gas costs for Ethereum transactions
- Best time to submit transactions for lower fees
- Whether to use L2 vs mainnet for a specific operation
- Understanding gas pricing mechanics (EIP-1559)
- Optimizing DeFi operations for gas efficiency
- Estimating transaction costs before execution

## Gas Optimization Framework

### 1. Gas Price Mechanics (EIP-1559)

Understanding the fee model:
- **Base fee**: Set by the network — adjusts up/down based on block fullness. This portion is burned.
- **Priority fee (tip)**: Paid to validators — determines transaction priority within a block.
- **Max fee**: Your maximum willingness to pay (base + priority). Unused portion is refunded.
- **Gas limit**: Maximum gas units the transaction can consume. Set too low = transaction fails. Set too high = overpaying.
- **Total cost**: Gas Used * (Base Fee + Priority Fee)

Current gas prices can be checked on:
- Etherscan gas tracker
- blocknative.com
- In-wallet gas estimation

### 2. Timing Strategies

Gas prices follow predictable patterns:
- **Lowest fees**: Weekends (Saturday/Sunday), and weekday early morning UTC (2:00-8:00 UTC) when US/Asia overlap is minimal
- **Highest fees**: Weekday US market hours (14:00-20:00 UTC), especially during NFT mints or market volatility
- **Avoid**: Periods of extreme market volatility — gas spikes during crashes as everyone rushes to manage positions
- **Tools**: Gas price alert services that notify when fees drop below your threshold

### 3. Transaction Optimization Techniques

Reduce gas consumption:
- **Batch transactions**: Use multicall or batching contracts to combine multiple operations into one transaction
- **Approve exact amounts**: Approving the exact amount needed uses slightly less gas than unlimited approval, but the gas savings are minimal — the real benefit is security
- **Token transfers**: ERC-20 transfers cost ~65K gas. ETH transfers cost only 21K gas. Minimize unnecessary token movements.
- **Avoid partial fills**: Set appropriate slippage to avoid reverted transactions that still cost gas
- **Cancel with replacement**: If a transaction is stuck, send a 0 ETH transaction to yourself with the same nonce and higher gas price

### 4. L2 vs Mainnet Decision Matrix

Choose the right layer:

| Use Case | Recommended | Reasoning |
|----------|-------------|-----------|
| < $500 DeFi position | L2 (Arbitrum/Base) | Gas would eat significant % on mainnet |
| $500-$5,000 DeFi | L2 preferred | Better ROI on L2 but mainnet acceptable |
| > $5,000 DeFi | Either | Gas is small % of position value |
| NFT minting | L2 if available | Minting costs 100K-300K gas |
| Simple transfer | L2 | 21K gas still costs $2-20 on mainnet |
| Smart contract deployment | Depends on users | Deploy where your users are |
| High-value, high-security | Mainnet | Maximum security and settlement guarantees |

### 5. L2 Gas Cost Comparison

Relative gas costs (approximate, varies):

| Layer | Simple Transfer | Token Swap | LP Position |
|-------|----------------|-----------|-------------|
| Ethereum Mainnet | $2-$20 | $10-$100 | $20-$200 |
| Arbitrum | $0.10-$0.50 | $0.30-$2.00 | $0.50-$3.00 |
| Optimism | $0.05-$0.30 | $0.20-$1.50 | $0.30-$2.00 |
| Base | $0.01-$0.10 | $0.05-$0.50 | $0.10-$1.00 |
| Polygon | $0.01-$0.05 | $0.05-$0.20 | $0.05-$0.30 |

Note: L2 costs depend on L1 data availability costs and blob fees post-EIP-4844.

### 6. Gas-Efficient DeFi Patterns

Specific strategies for common DeFi operations:
- **Yield farming**: Compound only when the reward value exceeds 2x the gas cost of compounding
- **Position adjustment**: Batch multiple adjustments into a single session when gas is low
- **Token swaps**: Use DEX aggregators (1inch, CowSwap, Paraswap) — they find optimal routes and can save 10-30% vs swapping directly
- **Approval management**: Use Permit2 when supported to avoid separate approval transactions
- **Staking/unstaking**: Some protocols allow claiming rewards during other operations — reduces separate transactions

### 7. Output Format

- **Current gas**: Base fee and estimated transaction cost
- **Recommendation**: Execute now / Wait for lower gas / Use L2
- **Cost estimate**: For the user's specific transaction on mainnet vs L2
- **Optimal timing**: Best time window based on current patterns
- **L2 suggestion**: Which L2 for the user's use case, with bridging instructions if needed
- **Gas savings tips**: Specific to the user's intended operation
