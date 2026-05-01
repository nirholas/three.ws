---
name: tax-loss-harvesting
description: Identify tax-loss harvesting opportunities in crypto portfolios by finding unrealized losses, calculating tax savings, and suggesting wash-sale-aware replacement strategies.
license: MIT
metadata:
  category: portfolio
  difficulty: intermediate
  author: sperax-team
  tags: [portfolio, tax, harvesting, losses, optimization]
---

# Tax-Loss Harvesting

## When to use this skill

Use when the user asks about:
- Reducing crypto tax obligations
- Finding unrealized losses in their portfolio
- Tax-loss harvesting strategies for crypto
- Wash sale rules and crypto (jurisdiction-dependent)
- Year-end tax planning for crypto holdings

## Harvesting Framework

### 1. Identify Loss Positions

Scan the portfolio for unrealized losses:
- **List all holdings** with cost basis and current market value
- **Calculate unrealized P&L** for each position (current value - cost basis)
- **Categorize by holding period**: Short-term (held < 1 year) vs long-term (held > 1 year)
- **Sort by loss magnitude**: Largest absolute losses first

| Asset | Cost Basis | Current Value | Unrealized P&L | Holding Period |
|-------|-----------|---------------|-----------------|----------------|
| Token A | $10,000 | $6,000 | -$4,000 | 8 months (ST) |
| Token B | $5,000 | $3,500 | -$1,500 | 14 months (LT) |

### 2. Tax Impact Calculation

Estimate the value of harvesting each loss:
- **Short-term losses** offset short-term gains (taxed at ordinary income rate, up to 37% in the US)
- **Long-term losses** offset long-term gains (taxed at 0/15/20% depending on bracket)
- **Net losses** can offset up to $3,000 of ordinary income per year (US), remainder carries forward
- **Calculate tax savings**: Loss amount * marginal tax rate = estimated tax reduction
- **Prioritize short-term losses** harvested against short-term gains for maximum benefit

### 3. Wash Sale Considerations

Address wash sale rules (jurisdiction-dependent):
- **US crypto status**: As of the user's tax year, check current IRS guidance on wash sale applicability to crypto. The 2025 infrastructure bill may have changed rules.
- **Traditional wash sale rule (stocks)**: Cannot buy back substantially identical asset within 30 days before or after the sale
- **If crypto wash sales apply**: Suggest waiting 31 days or swapping into a correlated but different asset
- **If wash sales do NOT apply**: Can sell and immediately rebuy (preserving exposure while capturing the loss)
- **Other jurisdictions**: Rules vary significantly — UK (30-day rule), EU, Australia, etc. Always advise consulting a local tax professional

### 4. Replacement Strategy

When maintaining market exposure after harvesting:
- **Same asset rebuy** (if wash sale doesn't apply): Sell and immediately repurchase — cost basis resets to current price
- **Correlated substitute**: Replace with a similar but distinct asset (e.g., sell one L1 token, buy another L1 token with similar beta)
- **Index/basket approach**: Replace individual position with a broader category exposure
- **DeFi alternative**: Move to a yield-generating position in a similar sector
- **Wait period**: If wash sale applies, set a calendar reminder to rebuy after the waiting period

### 5. Execution Plan

Step-by-step execution:
1. Calculate total realized gains for the year so far
2. Identify losses that offset those gains (match short-term with short-term first)
3. Determine optimal harvest amount (no need to harvest more losses than you have gains + $3K)
4. Execute the sell orders
5. Immediately execute replacement buys (if wash sale allows)
6. Record the transactions with precise timestamps and prices for tax reporting
7. Update cost basis records

### 6. Record Keeping

Document for tax filing:
- Date and time of each sell transaction
- Exact proceeds received
- Original cost basis and acquisition date
- Net gain or loss
- Replacement purchase details (date, price, quantity)
- Running total of harvested losses for the tax year

### 7. Output Format

- **Total unrealized losses available**: Dollar amount
- **Recommended harvest amount**: Based on gains to offset
- **Estimated tax savings**: Dollar amount at user's tax bracket
- **Positions to harvest**: Ordered list with amounts
- **Replacement strategy**: For each harvested position
- **Wash sale risk**: Whether this applies in user's jurisdiction
- **Action items**: Step-by-step execution plan with timing
- **Disclaimer**: This is educational guidance, not tax advice. Consult a qualified tax professional for your specific situation.
