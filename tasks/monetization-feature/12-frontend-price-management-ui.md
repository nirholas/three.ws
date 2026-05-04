---
status: not-started
---

# Prompt 12: Frontend Price Management UI

**Status:** Not Started

## Objective
Build the user interface within the "Monetization" tab for agent creators to view their skills and set prices for them.

## Explanation
This task involves dynamically generating a list of the agent's skills in the monetization tab. Each skill will have input fields for a price and currency, allowing the creator to manage their premium offerings.

## Instructions
- [ ] **Locate the agent editor's JavaScript file.**
- [ ] **Fetch and Display Skills:**
    - [ ] When the monetization tab is loaded, use the agent's data (which should already be loaded on the page) to get the list of skills.
    - [ ] Also, get the existing `skill_prices` for the agent.
    - [ ] Dynamically generate HTML to list each skill.
    - [ ] For each skill, create:
        - The skill name (as a label).
        - An `input` field for the `amount`.
        - A `select` dropdown for the `currency_mint` (e.g., with an option for USDC).
- [ ] **Populate Existing Prices:**
    - [ ] If a skill already has a price set, populate the input fields with the existing data.
- [ ] **Add a "Save" button** for each skill or a single "Save All Prices" button for the page.

## Code Example (JavaScript)

```javascript
// In the agent editor's JS file, in a function that renders the monetization tab

function renderMonetizationTab(agent) {
    const container = document.getElementById('skill-pricing-list');
    const skills = agent.skills || [];
    const prices = agent.skill_prices || {};

    if (skills.length === 0) {
        container.innerHTML = '<p>Add skills in the "Skills" tab first.</p>';
        return;
    }

    container.innerHTML = skills.map(skillName => {
        const price = prices[skillName] || { amount: 0, currency_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6T' };
        const priceInUsdc = price.amount / 1e6;

        return `
            <div class="skill-price-entry" data-skill-name="${skillName}">
                <label>${skillName}</label>
                <input type="number" class="price-input" value="${priceInUsdc}" min="0" step="0.01">
                <select class="currency-input">
                    <option value="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6T">USDC</option>
                </select>
            </div>
        `;
    }).join('') + '<button id="save-prices-btn">Save Prices</button>';
}
```
