---
status: not-started
last_updated: 2026-05-04
---
# Prompt 03: UI for Setting Skill Prices

## Objective
Create a user interface within the agent editor (`agent-edit.html`) that allows agent creators to set and update prices for their skills.

## Explanation
For creators to monetize their work, they need a simple and intuitive way to manage the prices of their skills. This task involves adding a new section to the agent editor page where each skill listed has an input field to set its price.

## Instructions
1.  **Locate the Agent Editor:**
    *   Open `agent-edit.html` and its corresponding JavaScript module, likely `src/agent-edit.js`.

2.  **Fetch Existing Prices:**
    *   When loading the agent for editing, the backend should also fetch and provide any existing prices from the `agent_skill_prices` table. The main agent object should be decorated with this information.

3.  **Implement the UI:**
    *   In the section where the agent's skills are displayed, modify the rendering logic.
    *   For each skill, display an input field for the price and a dropdown or static text for the currency (initially, we can hardcode to USDC).
    *   The input should be pre-filled with the existing price if it has been set.
    *   Add a "Save Prices" button or integrate the price updates into the main "Save Agent" functionality.

## Code Example (HTML Structure in `agent-edit.html`)

This is a conceptual HTML structure. You will need to integrate it into the existing template.

```html
<!-- Inside the agent editor form -->
<div class="panel">
    <h2 class="panel-title">Skill Monetization</h2>
    <p class="panel-subtitle">Set prices for your agent's skills in USDC.</p>
    <div id="skill-pricing-list">
        <!-- JavaScript will render individual skill inputs here -->
    </div>
    <button id="save-skill-prices" class="btn">Save Prices</button>
</div>
```

## Code Example (JavaScript - `src/agent-edit.js`)

This is how you might render the pricing inputs.

```javascript
// Assume `agent` object has `skills` array and `skill_prices` map
const skills = agent.skills || [];
const prices = agent.skill_prices || {};
const container = document.getElementById('skill-pricing-list');

container.innerHTML = skills.map(skill => {
    const price = prices[skill.name];
    const amount = price ? (price.amount / 1e6).toFixed(2) : ''; // Convert from lamports
    return `
        <div class="skill-price-entry">
            <label for="price-${skill.name}">${skill.name}</label>
            <div class="price-input-wrapper">
                <input
                    type="number"
                    id="price-${skill.name}"
                    data-skill-name="${skill.name}"
                    value="${amount}"
                    placeholder="e.g., 0.99"
                    min="0"
                    step="0.01"
                />
                <span class="currency-label">USDC</span>
            </div>
        </div>
    `;
}).join('');

// Add an event listener to the save button to collect and send data
document.getElementById('save-skill-prices').addEventListener('click', () => {
    const updatedPrices = {};
    document.querySelectorAll('.price-input-wrapper input').forEach(input => {
        const skillName = input.dataset.skillName;
        const amount = parseFloat(input.value);
        if (skillName && !isNaN(amount) && amount > 0) {
            updatedPrices[skillName] = {
                amount: Math.round(amount * 1e6), // Convert to lamports
                currency_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6a' // USDC mint
            };
        }
    });

    // Send `updatedPrices` to a new API endpoint
    fetch(`/api/agents/${agent.id}/skill-prices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedPrices)
    });
});
```
