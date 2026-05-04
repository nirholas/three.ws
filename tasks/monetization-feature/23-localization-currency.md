---
status: not-started
---
# Prompt 23: Price Localization

**Status:** Not Started

## Objective
Display skill prices in the user's local currency (e.g., USD) in addition to the cryptocurrency (e.g., USDC).

## Explanation
Showing prices in a familiar fiat currency makes them easier for users to understand and can increase the likelihood of a purchase. This requires integrating a third-party API to fetch real-time conversion rates.

## Instructions
1.  **Choose a currency conversion API** (e.g., CoinGecko, an exchange API).
2.  **Backend: Create a new microservice or a cached API endpoint (`/api/prices/conversion-rates`)** that fetches the current price of SOL, USDC, etc., in USD.
    - Cache the results for 5-10 minutes to avoid hitting API rate limits.
3.  **Frontend: In the marketplace, fetch the conversion rates from this new endpoint.**
4.  **When rendering a price, calculate and display the USD equivalent.**
    - Store the conversion rates globally so you don't have to re-fetch on every render.
5.  **Update the UI to show both prices, or allow the user to toggle.**

## Code Example (Frontend - displaying converted price)
```javascript
// Assume 'rates' is { "USDC": 1.00, "SOL": 150.25 }
// Assume 'price' is { amount: 1500000, currency_mint: "EPj..." (USDC) }

const cryptoAmount = price.amount / 1e6; // 1.5
const rate = rates['USDC']; // 1.00
const usdAmount = cryptoAmount * rate;

const priceDisplay = `${cryptoAmount.toFixed(2)} USDC (~$${usdAmount.toFixed(2)} USD)`;

// Render priceDisplay in the UI
```
This small change can significantly improve the user experience for a global audience.
