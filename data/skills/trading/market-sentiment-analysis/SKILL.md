---
name: market-sentiment-analysis
description: Analyze crypto market sentiment by synthesizing on-chain metrics, social signals, funding rates, and fear/greed indicators to gauge overall market positioning and mood.
license: MIT
metadata:
  category: trading
  difficulty: intermediate
  author: sperax-team
  tags: [trading, sentiment, market, social, funding-rates]
---

# Market Sentiment Analysis

## When to use this skill

Use when the user asks about:
- Current overall crypto market sentiment
- Whether the market is greedy or fearful
- Social media buzz around a specific token
- Funding rate analysis for leveraged positions
- Contrarian indicators and crowd positioning
- Whether it's a good time to buy or sell based on sentiment

## Sentiment Framework

### 1. Fear and Greed Index Interpretation

Assess the current state of market fear/greed:
- **0-24 (Extreme Fear)**: Market is very pessimistic — historically a buying zone for long-term holders
- **25-49 (Fear)**: Uncertainty prevails — caution warranted but opportunities may exist
- **50 (Neutral)**: Market is balanced
- **51-74 (Greed)**: Optimism building — consider taking some profits on winners
- **75-100 (Extreme Greed)**: Euphoria — historically precedes corrections

Note the trend direction: is fear/greed increasing or decreasing over 7d/30d?

### 2. On-Chain Sentiment Metrics

Analyze blockchain data for positioning signals:
- **Exchange inflows/outflows**: Net outflows = accumulation (bullish); net inflows = distribution (bearish)
- **Whale activity**: Large wallet movements to/from exchanges
- **MVRV ratio**: Market Value vs Realized Value — above 3.5 historically overheated, below 1.0 undervalued
- **SOPR (Spent Output Profit Ratio)**: Above 1 = holders selling at profit; below 1 = selling at loss
- **Active addresses trend**: Growing = healthy network activity
- **Stablecoin supply ratio**: High stablecoin supply relative to BTC market cap = dry powder ready to deploy

### 3. Derivatives Sentiment

Examine leveraged market positioning:
- **Funding rates**: Positive = longs paying shorts (bullish crowd); negative = shorts paying longs (bearish crowd)
- **Open interest**: Rising OI + rising price = strong trend; rising OI + flat price = coiled spring
- **Long/short ratio**: Extreme readings (>2.0 or <0.5) suggest crowded positioning
- **Liquidation levels**: Where are large clusters of liquidations? These act as magnets

### 4. Social Sentiment

Gauge crowd behavior:
- **Social volume**: Is discussion about the asset spiking? Sudden spikes often precede volatility
- **Weighted sentiment**: Net positive vs negative mentions
- **Influencer positioning**: Are major accounts uniformly bullish? Contrarian warning
- **Search trends**: Google Trends, YouTube views — retail interest proxy
- **Community activity**: Discord/Telegram member growth and activity levels

### 5. Contrarian Framework

Apply contrarian logic to extreme readings:
- When everyone is bullish and funding rates are extremely positive, consider reducing exposure
- When social sentiment is deeply negative and funding rates are negative, consider accumulating
- Maximum pessimism often coincides with bottoms; maximum optimism with tops
- This is not a timing tool — extremes can persist longer than expected

### 6. Output Format

- **Overall sentiment**: Extreme Fear / Fear / Neutral / Greed / Extreme Greed
- **Sentiment trend**: Improving / Stable / Deteriorating (vs 7d ago)
- **On-chain signal**: Accumulation / Neutral / Distribution
- **Derivatives signal**: Overleveraged long / Neutral / Overleveraged short
- **Social signal**: Euphoric / Positive / Neutral / Negative / Capitulation
- **Contrarian take**: What the crowd is likely wrong about
- **Actionable insight**: Specific suggestion based on the aggregate signal
- **Confidence**: High / Medium / Low — based on signal agreement
