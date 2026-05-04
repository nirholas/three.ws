---
status: not-started
last_updated: 2026-05-04
---
# Prompt 20: Support for Multiple Currencies

## Objective
Extend the monetization system to allow creators to set prices and users to pay in different SPL tokens (e.g., BONK, RENDER) in addition to USDC.

## Explanation
To increase flexibility and appeal to different communities, we should support more than just one currency. This requires changes to how prices are stored, how transactions are built, and how data is displayed.

## Instructions
1.  **Currency Whitelist:**
    *   In the backend configuration, create a whitelist of supported SPL token mints. This should be a list of objects, each containing the mint address, symbol, name, and decimals. This prevents creators from listing arbitrary, untrusted tokens.

2.  **Update UI for Setting Prices:**
    *   In the agent editor (`agent-edit.html`), the price input for each skill should now include a dropdown (`<select>`) menu next to the amount.
    *   This dropdown should be populated with the symbols of the whitelisted currencies.
    *   When saving, the chosen `currency_mint` is sent along with the `amount`.

3.  **Update Purchase Preparation API:**
    *   The `purchase-prep` API now needs to handle the `currency_mint` of the skill being purchased.
    *   All the `spl-token` instructions must be created using the correct mint address from the skill's price data.

4.  **Frontend Wallet Interaction:**
    *   The frontend needs to be aware of the currency being used. When preparing the purchase, it's good practice to check if the user has a sufficient balance of the required token *before* showing the sign prompt. This can be done using `connection.getTokenAccountBalance`.
    *   The UI should clearly display the correct currency symbol (e.g., "Purchase for 500 BONK").

5.  **Update Creator Dashboard:**
    *   The sales data aggregation must now `GROUP BY currency_mint` to show total earnings for each currency separately.

## Code Example (Currency Whitelist)

```javascript
// In a config file, e.g., api/_lib/config.js
export const SUPPORTED_CURRENCIES = {
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6a': {
        symbol: 'USDC',
        decimals: 6,
    },
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': {
        symbol: 'BONK',
        decimals: 5,
    }
};
```

## Code Example (Price Setting UI Change)

```javascript
// In agent-edit.js, when rendering price inputs
const selectHtml = `<select class="currency-select" data-skill-name="${skillName}">
    ${Object.entries(SUPPORTED_CURRENCIES).map(([mint, {symbol}]) =>
        `<option value="${mint}" ${price?.currency_mint === mint ? 'selected' : ''}>
            ${symbol}
        </option>`
    ).join('')}
</select>`;

// The input group would now be: <input type="number"> and the <select>
```
