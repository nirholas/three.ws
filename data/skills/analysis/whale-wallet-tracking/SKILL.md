---
name: whale-wallet-tracking
description: Track and analyze whale wallet activity including large transfers, exchange movements, accumulation patterns, and smart money positioning to identify potential market-moving behavior.
license: MIT
metadata:
  category: analysis
  difficulty: advanced
  author: sperax-team
  tags: [analysis, whale, wallet, tracking, smart-money]
---

# Whale Wallet Tracking

## When to use this skill

Use when the user asks about:
- Tracking large wallet movements for a specific token
- Identifying whale accumulation or distribution
- Understanding smart money positioning
- Detecting large exchange inflows/outflows
- Monitoring known entity wallets (funds, foundations, early investors)

## Tracking Framework

### 1. Define Whale Thresholds

Set appropriate thresholds for the specific token:
- **Large-cap tokens** (BTC, ETH): Whale = top 100 non-exchange wallets or >$10M holdings
- **Mid-cap tokens**: Whale = top 50 holders or >$1M holdings
- **Small-cap tokens**: Whale = top 20 holders or >$100K holdings
- Always exclude known exchange wallets, contract addresses, and bridge wallets from analysis
- Identify labeled wallets: exchanges, foundations, team wallets, known funds

### 2. Movement Classification

Categorize whale transactions:

| Movement Type | Direction | Interpretation |
|--------------|-----------|----------------|
| Exchange deposit | Wallet to Exchange | Potential sell intent — bearish signal |
| Exchange withdrawal | Exchange to Wallet | Accumulation — bullish signal |
| Wallet to wallet | Non-exchange transfer | OTC deal, rebalancing, or cold storage rotation |
| Contract interaction | Wallet to contract | DeFi activity — staking, LP, lending |
| New wallet accumulation | Multiple sources to new wallet | New whale appearing — could be fund/institution |

### 3. Pattern Detection

Look for these significant patterns:
- **Steady accumulation**: Consistent withdrawals from exchanges over days/weeks — strong bullish signal
- **Sudden large deposits**: Multiple whales depositing to exchanges simultaneously — coordinated selling risk
- **Dormant wallet activation**: Wallets inactive for 6+ months suddenly moving — check if it's a known entity
- **Concentration increase**: Top 10 wallets growing their share — could indicate manipulation risk
- **Smart money entry**: Wallets with historical early-entry track records adding a new position

### 4. Exchange Flow Analysis

Monitor aggregate exchange movements:
- **Net exchange flow**: Total inflows minus outflows over 24h, 7d
- **Exchange reserve trend**: Is total exchange balance increasing or decreasing?
- **Exchange-specific flows**: Are flows concentrated on one exchange? (potential listing/delisting activity)
- **Stablecoin exchange flows**: Large stablecoin inflows to exchanges = dry powder for buying

### 5. Entity Attribution

When possible, link wallets to known entities:
- **VC funds**: Identify unlock schedules and typical selling patterns
- **Project treasury**: Monitor for unexpected outflows
- **Market makers**: Distinguish legitimate market making from directional bets
- **MEV bots**: Filter out MEV activity to focus on genuine whale positioning
- **Bridge wallets**: Track cross-chain flows to identify which chains are receiving capital

### 6. Alert-Worthy Events

Flag these as high-priority signals:
- Any single transfer > 1% of circulating supply
- Exchange deposit of > 0.5% of daily volume
- Team/foundation wallet moving tokens for the first time
- Multiple whales (3+) making the same directional move within 24h
- Dormant whale (1+ year inactive) activating

### 7. Output Format

- **Token**: Name and chain
- **Timeframe**: Analysis period (24h, 7d, 30d)
- **Net whale flow**: Accumulation / Neutral / Distribution
- **Largest movements**: Top 3-5 transactions with from/to labels and amounts
- **Exchange flow**: Net inflow/outflow and trend
- **Smart money signal**: What are known profitable wallets doing?
- **Notable entity activity**: Any labeled wallets with significant moves
- **Risk assessment**: Is whale activity suggesting potential volatility?
- **Interpretation**: Plain-language summary of what the whale data suggests
