---
name: lstm-price-prediction-guide
description: Guide to LSTM-based cryptocurrency price prediction. Covers data preprocessing, feature engineering, LSTM architecture, training, evaluation, and deployment. Includes TensorFlow/Keras implementation with technical indicators and sentiment features.
license: MIT
metadata:
  category: analysis
  difficulty: advanced
  author: nich
  tags: [analysis, lstm-price-prediction-guide]
---

# LSTM Price Prediction Guide

A guide to building LSTM (Long Short-Term Memory) neural networks for cryptocurrency price prediction. Covers the full pipeline from data collection to model deployment.

## Pipeline Overview

```
Data Collection → Feature Engineering → Preprocessing → Model Training → Evaluation → Deployment
     │                    │                  │                │               │            │
 CoinGecko,         Indicators,         Normalize,       LSTM layers,    RMSE/MAE,    REST API
 Binance API      Sentiment, Volume     Sequence data    Dropout, Dense   Backtesting   or MCP
```

## Data Collection

```python
import pandas as pd
from cryptodatapy import DataRequest

# Fetch historical OHLCV data
dr = DataRequest(
    tickers=['SPA'],
    fields=['open', 'high', 'low', 'close', 'volume'],
    freq='1h',
    start_date='2023-01-01',
    source='binance'
)
data = dr.fetch()
```

## Feature Engineering

### Technical Indicators

```python
import ta

def add_features(df):
    # Moving averages
    df['sma_7'] = ta.trend.sma_indicator(df['close'], window=7)
    df['sma_25'] = ta.trend.sma_indicator(df['close'], window=25)
    df['ema_12'] = ta.trend.ema_indicator(df['close'], window=12)
    
    # RSI
    df['rsi'] = ta.momentum.rsi(df['close'], window=14)
    
    # MACD
    macd = ta.trend.MACD(df['close'])
    df['macd'] = macd.macd()
    df['macd_signal'] = macd.macd_signal()
    
    # Bollinger Bands
    bb = ta.volatility.BollingerBands(df['close'])
    df['bb_upper'] = bb.bollinger_hband()
    df['bb_lower'] = bb.bollinger_lband()
    
    # Volume indicators
    df['volume_sma'] = df['volume'].rolling(window=20).mean()
    df['volume_ratio'] = df['volume'] / df['volume_sma']
    
    # Returns
    df['returns'] = df['close'].pct_change()
    df['log_returns'] = np.log(df['close'] / df['close'].shift(1))
    
    return df.dropna()
```

### Feature List

| Feature | Type | Description |
|---------|------|-------------|
| SMA (7, 25, 50) | Trend | Simple moving averages |
| EMA (12, 26) | Trend | Exponential moving averages |
| RSI (14) | Momentum | Relative strength index |
| MACD | Momentum | Moving average convergence |
| Bollinger Bands | Volatility | Price channels |
| Volume Ratio | Volume | Relative volume |
| Returns | Price | Percentage returns |
| ATR | Volatility | Average true range |

## Data Preprocessing

```python
from sklearn.preprocessing import MinMaxScaler
import numpy as np

# Scale features to [0, 1]
scaler = MinMaxScaler()
scaled_data = scaler.fit_transform(features)

# Create sequences for LSTM
def create_sequences(data, seq_length=60):
    X, y = [], []
    for i in range(seq_length, len(data)):
        X.append(data[i - seq_length:i])
        y.append(data[i, 0])  # Predict close price
    return np.array(X), np.array(y)

X, y = create_sequences(scaled_data, seq_length=60)

# Train/validation/test split (70/15/15)
train_size = int(len(X) * 0.7)
val_size = int(len(X) * 0.15)

X_train, y_train = X[:train_size], y[:train_size]
X_val, y_val = X[train_size:train_size+val_size], y[train_size:train_size+val_size]
X_test, y_test = X[train_size+val_size:], y[train_size+val_size:]
```

## LSTM Model

```python
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense, Dropout
from tensorflow.keras.callbacks import EarlyStopping

model = Sequential([
    LSTM(128, return_sequences=True, input_shape=(X_train.shape[1], X_train.shape[2])),
    Dropout(0.2),
    LSTM(64, return_sequences=True),
    Dropout(0.2),
    LSTM(32, return_sequences=False),
    Dropout(0.2),
    Dense(16, activation='relu'),
    Dense(1)  # Price prediction
])

model.compile(optimizer='adam', loss='mse', metrics=['mae'])

history = model.fit(
    X_train, y_train,
    validation_data=(X_val, y_val),
    epochs=100,
    batch_size=32,
    callbacks=[EarlyStopping(patience=10, restore_best_weights=True)]
)
```

## Evaluation

```python
from sklearn.metrics import mean_squared_error, mean_absolute_error

predictions = model.predict(X_test)

# Inverse transform to get actual prices
predictions_inv = scaler.inverse_transform(...)
actual_inv = scaler.inverse_transform(...)

rmse = np.sqrt(mean_squared_error(actual_inv, predictions_inv))
mae = mean_absolute_error(actual_inv, predictions_inv)

print(f"RMSE: ${rmse:.4f}")
print(f"MAE: ${mae:.4f}")
```

### Metrics to Watch

| Metric | Good | Acceptable |
|--------|------|-----------|
| RMSE | < 2% of price | < 5% |
| MAE | < 1.5% of price | < 4% |
| Direction Accuracy | > 60% | > 55% |
| Sharpe Ratio (backtest) | > 1.5 | > 1.0 |

## Disclaimer

⚠️ **LSTM predictions are for educational purposes only.** Crypto markets are highly volatile and unpredictable. Never use model predictions as the sole basis for trading decisions. Past performance does not guarantee future results.

## Links

- GitHub: https://github.com/nirholas/LSTM-price-prediction
- TensorFlow: https://www.tensorflow.org
- ta-lib: https://ta-lib.org
- Sperax: https://app.sperax.io
