---
name: trade-execution-checklist
description: A structured pre-trade checklist covering position sizing, risk management, entry/exit criteria, and execution best practices to ensure disciplined trading decisions.
license: MIT
metadata:
  category: trading
  difficulty: beginner
  author: sperax-team
  tags: [trading, risk-management, checklist, position-sizing, execution]
---

# Trade Execution Checklist

## When to use this skill

Use when the user:
- Is about to execute a trade and wants a sanity check
- Needs help with position sizing and risk management
- Wants a structured framework for trade planning
- Asks about stop-loss placement or take-profit levels
- Needs to evaluate their risk-reward ratio before entering

## Pre-Trade Checklist

### 1. Trade Thesis Validation

Before any execution, confirm:
- **Clear thesis**: Can you state in one sentence why this trade should work?
- **Catalyst**: What will drive the price in your direction? (news, technical level, on-chain event)
- **Timeframe**: Is this a scalp (hours), swing (days-weeks), or position (weeks-months)?
- **Edge identification**: What do you know or see that the market might not be pricing in?
- **Invalidation**: At what specific price or condition is your thesis wrong?

### 2. Position Sizing

Calculate appropriate size using these rules:
- **Risk per trade**: Never risk more than 1-2% of total portfolio on a single trade
- **Position size formula**: Position Size = (Portfolio * Risk %) / (Entry - Stop Loss)
- **Maximum position**: Even with tight stops, cap single positions at 5-10% of portfolio
- **Correlation check**: Are you already exposed to this sector? Avoid stacking correlated positions

Example calculation:
- Portfolio: $50,000
- Risk per trade: 2% = $1,000
- Entry: $100, Stop loss: $90 (10% away)
- Position size: $1,000 / $10 = 100 units = $10,000 (20% of portfolio)

### 3. Entry Strategy

Plan the entry method:
- **Limit vs market**: Use limit orders for better fills unless momentum is urgent
- **Scaling in**: Consider entering in 2-3 tranches (e.g., 40/30/30) to average entry
- **Slippage awareness**: For low-liquidity tokens, check order book depth first
- **Gas timing**: For on-chain trades, check gas prices and consider low-activity periods
- **DEX vs CEX**: Compare execution costs including gas, fees, and slippage

### 4. Risk Management Setup

Configure protective measures before entering:
- **Stop loss**: Place immediately after entry — never trade without one
  - Below recent swing low for longs
  - Above recent swing high for shorts
  - Account for typical volatility — avoid stops within normal noise range
- **Take profit targets**: Set at least 2 levels
  - TP1: 1:1.5 risk-reward — take 50% off
  - TP2: 1:3 risk-reward — take remaining or trail stop
- **Risk-reward ratio**: Minimum 1:1.5, ideally 1:2 or better
- **Maximum loss scenario**: If everything goes wrong, what do you lose?

### 5. Execution Checklist

Final checks before clicking "buy" or "sell":

- [ ] Thesis is clear and written down
- [ ] Position size is within risk limits (1-2% risk)
- [ ] Entry price and method determined
- [ ] Stop loss level set (and will be placed immediately)
- [ ] Take profit targets defined (at least 2 levels)
- [ ] Risk-reward ratio is >= 1:1.5
- [ ] Not already overexposed to this sector
- [ ] Checked for upcoming events (earnings, unlocks, macro) that could override technicals
- [ ] Emotional state check — not revenge trading or FOMO buying
- [ ] Sufficient liquidity to exit at intended size

### 6. Post-Entry Management

After the trade is live:
- **Move stop to break-even** after TP1 is hit
- **Trail stop** on remaining position using ATR or swing structure
- **Time stop**: If the trade hasn't moved in your expected timeframe, re-evaluate
- **Journal the trade**: Record entry reason, size, levels, and emotional state

### 7. Output Format

For each trade evaluation, provide:
- **Trade**: Asset, direction (long/short), timeframe
- **Entry**: Price and method
- **Stop loss**: Price and distance from entry (%)
- **Take profit**: TP1 and TP2 prices
- **Risk-reward**: Ratio calculation
- **Position size**: Amount and % of portfolio
- **Risk amount**: Dollar amount at risk
- **Checklist status**: Pass / Fail with specific notes
- **Recommendation**: Proceed / Adjust / Do not trade
