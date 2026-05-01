---
name: technical-analysis
description: Perform technical analysis on crypto assets using price action, chart patterns, indicators, and volume analysis to identify trading opportunities and key support/resistance levels.
license: MIT
metadata:
  category: trading
  difficulty: intermediate
  author: sperax-team
  tags: [trading, technical-analysis, charts, indicators, price-action]
---

# Technical Analysis

## When to use this skill

Use when the user asks about:
- Analyzing a token's price chart or trend
- Identifying support and resistance levels
- Evaluating momentum indicators (RSI, MACD, etc.)
- Recognizing chart patterns (head and shoulders, triangles, etc.)
- Determining entry/exit points for a trade
- Assessing whether an asset is overbought or oversold

## Analysis Framework

### 1. Trend Identification

Establish the macro context first:
- **Primary trend** (weekly/monthly): Bull, bear, or sideways
- **Secondary trend** (daily): Direction and strength within primary trend
- **Short-term trend** (4h/1h): Immediate momentum direction
- **Trend confirmation**: Are higher timeframe and lower timeframe aligned?
- Use moving averages (20 EMA, 50 SMA, 200 SMA) to confirm trend direction

### 2. Support and Resistance

Identify key price levels:
- **Historical support**: Previous swing lows with significant volume
- **Historical resistance**: Previous swing highs and rejection zones
- **Psychological levels**: Round numbers (e.g., $50K BTC, $2K ETH)
- **Moving average support/resistance**: Price interaction with 50/200 SMA
- **Volume profile**: High-volume nodes act as support/resistance (VPVR)
- **Fibonacci retracement levels**: 0.236, 0.382, 0.5, 0.618, 0.786 from recent swing

### 3. Indicator Analysis

Apply and interpret key indicators:

**Momentum**:
- RSI (14): Below 30 oversold, above 70 overbought; check for divergences
- MACD: Signal line crossovers, histogram momentum, zero-line position
- Stochastic RSI: Fast momentum shifts in ranging markets

**Trend strength**:
- ADX: Below 20 weak trend, above 25 trending, above 50 strong trend
- Moving average spacing: Expanding MAs = strengthening trend

**Volume**:
- Volume confirmation: Moves on rising volume are more reliable
- Volume divergence: Price up but volume declining = weakening momentum
- OBV (On-Balance Volume): Cumulative volume direction

### 4. Chart Pattern Recognition

Identify and assess common patterns:
- **Reversal patterns**: Head and shoulders, double top/bottom, rising/falling wedge
- **Continuation patterns**: Flags, pennants, ascending/descending triangles
- **Measured move targets**: Calculate pattern target using the pattern's height
- **Confirmation**: A pattern is not valid until the neckline/boundary breaks with volume

### 5. Multi-Timeframe Confluence

A setup is stronger when multiple timeframes agree:
- Weekly: Establishes the dominant trend and key macro levels
- Daily: Identifies intermediate structure and patterns
- 4h/1h: Fine-tunes entry and exit timing
- A bullish setup on the 4h chart within a weekly downtrend is lower probability

### 6. Output Format

Present the analysis as:
- **Asset**: Token and pair analyzed
- **Timeframe**: Primary timeframe of analysis
- **Trend**: Bullish / Bearish / Neutral with confidence level
- **Key support levels**: List 2-3 in order of importance
- **Key resistance levels**: List 2-3 in order of importance
- **Indicators summary**: RSI, MACD, volume assessment
- **Pattern identified**: If any, with target and invalidation
- **Bias**: Long / Short / Neutral
- **Key levels to watch**: Specific prices that would confirm or invalidate the thesis
- **Disclaimer**: Technical analysis is probabilistic, not predictive. Always use risk management.
