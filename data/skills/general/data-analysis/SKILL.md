---
name: data-analysis
description: Framework for analyzing numerical crypto data including price series, on-chain metrics, protocol statistics, and portfolio performance with structured visualization guidance.
license: MIT
metadata:
  category: general
  difficulty: intermediate
  author: sperax-team
  tags: [general, data, analysis, statistics, visualization]
---

# Data Analysis

## When to use this skill

Use when the user asks about:
- Analyzing numerical data (prices, volumes, metrics)
- Calculating statistics (averages, percentiles, correlations)
- Identifying trends or anomalies in data
- Comparing performance across time periods or assets
- Presenting data in a clear, structured format

## Analysis Framework

### 1. Data Understanding

Before analyzing, assess the data:
- **Source**: Where does the data come from? Is it reliable?
- **Time range**: What period does the data cover?
- **Granularity**: Daily, hourly, per-block?
- **Completeness**: Are there gaps or missing data points?
- **Units**: USD, ETH-denominated, percentage, raw count?
- **Adjustments needed**: Inflation adjustment, normalization, outlier handling?

### 2. Descriptive Statistics

Compute baseline statistics:
- **Central tendency**: Mean, median, mode — median is more robust for skewed crypto data
- **Dispersion**: Standard deviation, range, interquartile range (IQR)
- **Distribution shape**: Skewness (crypto returns are typically negatively skewed) and kurtosis (fat tails are common)
- **Percentiles**: 5th, 25th, 50th, 75th, 95th — useful for setting expectations

Present as a summary table:

| Metric | Value |
|--------|-------|
| Mean | X |
| Median | Y |
| Std Dev | Z |
| Min | A |
| Max | B |
| Count | N |

### 3. Trend Analysis

Identify and quantify trends:
- **Moving averages**: 7-day, 30-day, 90-day to smooth noise
- **Growth rates**: Period-over-period percentage change (daily, weekly, monthly)
- **CAGR**: Compound Annual Growth Rate for longer-term performance
- **Trend direction**: Classify as uptrend, downtrend, or sideways based on moving average slopes
- **Trend strength**: How consistent is the trend? R-squared of linear regression

### 4. Comparative Analysis

When comparing across entities or time periods:
- **Normalize data**: Convert to percentage change from a common starting point for fair comparison
- **Relative performance**: Calculate alpha (excess return) relative to a benchmark (BTC, ETH, or market index)
- **Correlation matrix**: How closely do the compared items move together?
- **Ratio analysis**: Asset A / Asset B ratio to identify relative value trends
- **Ranking**: Order by performance metric with percentile rankings

### 5. Anomaly Detection

Flag unusual data points:
- **Z-score method**: Values beyond 2-3 standard deviations from the mean
- **IQR method**: Values below Q1 - 1.5*IQR or above Q3 + 1.5*IQR
- **Volume spikes**: Daily volume exceeding 3x the 30-day average
- **Price gaps**: Sudden moves exceeding 2x the average daily range
- **Contextual check**: Always check if an anomaly has a known cause (hack, listing, upgrade)

### 6. Data Presentation

Structure output for clarity:

**Tables** — best for exact values and multi-metric comparison:
- Align numbers to the right
- Use consistent decimal places
- Include units in column headers
- Sort by the most relevant column

**Series summaries** — when presenting time-series data textually:
- Start with the current value and direction
- Reference key inflection points (when did the trend change?)
- Compare to relevant time periods (YTD, QoQ, YoY)
- Highlight the single most significant data point

### 7. Caveats and Limitations

Always note:
- **Survivorship bias**: Analysis of "top tokens" ignores failed ones
- **Look-ahead bias**: Past data analysis doesn't predict future performance
- **Sample size**: Small samples (less than 30 data points) produce unreliable statistics
- **Data quality**: On-chain data may include wash trading, bots, or fake volume
- **Correlation vs causation**: Two metrics moving together doesn't mean one causes the other

### 8. Output Format

- **Analysis type**: Descriptive / Comparative / Trend / Anomaly
- **Data summary**: Key statistics in a table
- **Main finding**: The single most important insight from the data
- **Supporting findings**: 2-4 additional observations
- **Trend assessment**: Direction and strength
- **Anomalies**: Any flagged data points with context
- **Confidence**: High / Medium / Low based on data quality and sample size
- **Limitations**: Relevant caveats for this specific analysis
