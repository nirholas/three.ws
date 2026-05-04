---
status: not-started
---

# Prompt 21: Multi-Currency Support

**Status:** Not Started

## Objective
Extend the skill pricing and payment system to support multiple SPL tokens (e.g., BONK, RENDER) in addition to USDC.

## Explanation
To maximize flexibility for users and creators, the platform should not be limited to a single currency. This requires changes on both the backend (to store different currency mints) and the frontend (to display the correct currency symbol and handle different decimals).

## Instructions
- [ ] **Backend:**
    - [ ] The `agent_skill_prices` and `skill_purchases` tables already have a `currency_mint` column, which is good.
    - [ ] When creating a Solana Pay transaction, ensure you are using the correct `splToken` mint address from the skill's price information.
- [ ] **Frontend - Monetization Tab:**
    - [ ] Update the currency `<select>` dropdown in the agent editor to include options for other popular SPL tokens (USDC, BONK, etc.). The `value` for each option should be the token's mint address.
- [ ] **Frontend - Marketplace:**
    - [ ] When displaying the price and the "Buy" button, fetch the token's metadata (symbol, decimals) from a source like the Solana Token List or a simple hardcoded map.
    - [ ] Use the correct number of decimals when converting the `amount` from lamports to a human-readable format (e.g., BONK has 5 decimals, USDC has 6).
    - [ ] Display the correct currency symbol (e.g., "$BONK", "$RNDR").

## Code Example (Frontend Price Display)

```javascript
// A simple map of known tokens. In a real app, this might come from an API.
const TOKEN_MAP = {
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6T': { symbol: 'USDC', decimals: 6 },
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': { symbol: 'BONK', decimals: 5 },
};

// In the marketplace rendering logic...
const price = skillPrices[name]; // e.g., { amount: 500000, currency_mint: 'Dez...' }
if (price) {
    const tokenInfo = TOKEN_MAP[price.currency_mint] || { symbol: 'Unknown', decimals: 0 };
    const displayAmount = price.amount / Math.pow(10, tokenInfo.decimals);
    const badge = `<span class="price-badge">${displayAmount.toFixed(2)} ${tokenInfo.symbol}</span>`;
    // ...
}
```
