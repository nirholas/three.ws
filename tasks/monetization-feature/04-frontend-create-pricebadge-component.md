---
status: completed
---

# Prompt 4: Frontend - Create Reusable PriceBadge Component

## Objective
Develop a reusable UI component to display skill prices consistently across the application.

## Explanation
To maintain a consistent user experience, we should encapsulate the logic for displaying skill prices into a single, reusable component. This `PriceBadge` component will handle the formatting of the price and the visual distinction between "Free" and paid skills. Creating this component now will save time and prevent code duplication as we build more monetization features.

## Instructions
1.  **Create the Component File:**
    *   Create a new file for your component, for example, `src/components/PriceBadge.js`.
    *   This component can be a simple function that returns an HTML string or a more complex component if you are using a framework like React or Svelte.

2.  **Implement the Component Logic:**
    *   The component should accept the price information (e.g., `amount` and `currency`) as props.
    *   If the price is missing or zero, it should render a "Free" badge.
    *   If a price is provided, it should format the amount (e.g., convert from lamports) and display it with the currency.
    *   It should apply the appropriate CSS classes (`price-free` or `price-paid`) based on the price.

3.  **Refactor `marketplace.js`:**
    *   Import and use the new `PriceBadge` component in the `renderDetail` function in `src/marketplace.js` to replace the inline badge creation logic.

## Code Example (`src/components/PriceBadge.js`)

```javascript
// A simple functional component that returns an HTML string.

// Mapping of mint addresses to human-readable currency symbols.
const CURRENCY_SYMBOLS = {
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6a': 'USDC',
    'So11111111111111111111111111111111111111112': 'SOL',
};

// Divisors to convert from smallest unit to standard unit.
const CURRENCY_DIVISORS = {
    'USDC': 1e6,
    'SOL': 1e9,
};

export function PriceBadge(price) {
    if (!price || !price.amount) {
        return `<span class="price-badge price-free">Free</span>`;
    }

    const symbol = CURRENCY_SYMBOLS[price.currency_mint] || '???';
    const divisor = CURRENCY_DIVISORS[symbol] || 1;
    const formattedAmount = (price.amount / divisor).toFixed(2);

    return `
        <span class="price-badge price-paid">
            ${formattedAmount} ${symbol}
        </span>
    `;
}
```

### Refactored Usage in `src/marketplace.js`

```javascript
import { PriceBadge } from './components/PriceBadge.js'; // Adjust path

// ... inside renderDetail function
const skillPrices = a.skill_prices || {};
$('d-skills').innerHTML = skillsArr.length
    ? skillsArr.map((s) => {
        const name = typeof s === 'string' ? s : (s.name || '');
        const price = skillPrices[name];
        return `<span class="skill-entry">${escapeHtml(name)}${PriceBadge(price)}</span>`;
    }).join(' ')
    : '<div>This Agent has no skills defined.</div>';
```
