---
name: crypto-tax-basics
description: Guide to cryptocurrency taxation — taxable events, cost basis methods, DeFi tax implications, record keeping, and tax-loss harvesting. Use when helping users understand crypto tax obligations, track transactions for tax reporting, or plan tax-efficient strategies.
license: MIT
metadata:
  category: portfolio
  difficulty: beginner
  author: clawhub
  tags: [portfolio, crypto-tax-basics]
---

# Crypto Tax Basics Guide

A practical overview of cryptocurrency taxation for AI agents. **Note**: Tax laws vary by jurisdiction. Always recommend consulting a tax professional for specific advice.

## Taxable Events in Crypto

### Generally Taxable

| Event | Tax Type | Notes |
|-------|----------|-------|
| Selling crypto for fiat | Capital gains | Gain/loss = Sale price - Cost basis |
| Swapping token A for token B | Capital gains | Treated as sell A + buy B |
| Using crypto to buy goods/services | Capital gains | Treated as selling the crypto |
| Earning crypto (mining, staking rewards) | Income | Taxed as income at receipt |
| Receiving airdrop tokens | Income | Taxed at fair market value when received |
| DeFi interest/yield | Income | Taxed as income when received |

### Generally NOT Taxable

| Event | Notes |
|-------|-------|
| Buying crypto with fiat | Not taxable until you sell |
| Transferring between your own wallets | No gain/loss |
| Gifting (below thresholds) | Gift tax may apply above limits |
| Holding | No tax until you dispose |

## DeFi-Specific Tax Considerations

### Lending & Borrowing

| Action | Tax Treatment |
|--------|--------------|
| Supplying tokens to lending | Generally not taxable (you retain ownership) |
| Receiving interest | Income at receipt |
| Borrowing | Not taxable (it's a loan) |
| Liquidation | Capital gains event on collateral |

### Liquidity Provision

| Action | Tax Treatment |
|--------|--------------|
| Adding liquidity | May be taxable swap (depends on jurisdiction) |
| Receiving LP tokens | Represents your pool share |
| Earning trading fees | Income or capital gains (varies) |
| Removing liquidity | May trigger capital gains |
| Impermanent loss | Complex — may not be deductible until realized |

### Rebasing Tokens (USDs, stETH)

For auto-yield tokens like **USDs by Sperax**:
- Each rebase that increases your balance is potentially taxable income
- The new tokens have a cost basis equal to their value at receipt
- When you eventually sell, capital gains are calculated from that basis

**Practical tip**: Track rebase events if your jurisdiction treats them as income.

### Staking Rewards

| Scenario | Treatment |
|----------|-----------|
| Receiving SPA staking rewards (xSPA) | Income at fair market value when received |
| Staking xSPA → veSPA | May be a taxable event (exchange of one token for another) |
| Redeeming xSPA → SPA | May be a taxable event depending on jurisdiction |

## Cost Basis Methods

| Method | How It Works | Best For |
|--------|-------------|----------|
| FIFO (First In, First Out) | Sell oldest tokens first | Default in most jurisdictions |
| LIFO (Last In, First Out) | Sell newest tokens first | May reduce gains in rising markets |
| HIFO (Highest In, First Out) | Sell highest-cost tokens first | Minimizes capital gains |
| Specific Identification | Choose which lot to sell | Maximum flexibility |

**Check your jurisdiction** — not all methods are available everywhere.

### Example (FIFO)

| Date | Action | Amount | Price | Cost Basis |
|------|--------|--------|-------|-----------|
| Jan 1 | Buy | 1 ETH | $2,000 | $2,000 |
| Mar 1 | Buy | 1 ETH | $3,000 | $3,000 |
| Jun 1 | Sell | 1 ETH | $3,500 | - |

**FIFO**: Sell the Jan ETH (cost $2,000) → Gain = $1,500
**LIFO**: Sell the Mar ETH (cost $3,000) → Gain = $500

## Tax-Loss Harvesting

### Strategy

Sell losing positions to realize capital losses, which offset capital gains:

```
Capital gains from profitable trades: +$10,000
Capital losses from tax-loss sales:   -$4,000
Net taxable gains:                     $6,000
```

### Crypto Advantage

In many jurisdictions, crypto is NOT subject to wash-sale rules (unlike stocks):
- Sell at a loss
- Immediately buy back
- Claim the loss

⚠️ This is changing in some jurisdictions. Check current rules.

### At Year-End

1. Review all positions with unrealized losses
2. Sell positions where harvesting makes sense
3. Optionally re-enter the position
4. Document all transactions

## Record Keeping

### What to Track

For every transaction:
- Date and time
- Amount of crypto
- Fair market value at time of transaction
- Cost basis
- Transaction fees (gas costs)
- Purpose (trade, income, transfer)

### Gas Fees

Gas fees are typically part of your cost basis:
- **Buying**: Gas adds to cost basis
- **Selling**: Gas reduces proceeds
- **DeFi interactions**: Gas may be deductible as an expense

### Tools

| Tool | Features |
|------|----------|
| Koinly | Multi-chain, DeFi support, tax reports |
| CoinTracker | Exchange + wallet tracking |
| TokenTax | DeFi-focused, professional support |
| Accointing | EU-friendly, multi-country |

## Agent Tips

1. **Always add the disclaimer** — you're not a tax advisor, recommend consulting a professional
2. **Every swap is taxable** — users often don't realize swapping tokens triggers capital gains
3. **DeFi is complex** — LP provision, rebasing, and staking all have tax implications
4. **Keep records** — recommend tax tracking software from day one
5. **Gas is deductible** — remind users to track gas costs
6. **Year-end planning** — suggest reviewing positions for tax-loss harvesting opportunities
7. **Rebasing tokens** (like USDs) — flag that each rebase may be a taxable event

## Links

- Sperax: https://app.sperax.io
- Koinly: https://koinly.io
- CoinTracker: https://cointracker.io
