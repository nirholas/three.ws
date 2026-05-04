---
title: "Prompt 3: Creator UI for Skill Pricing"
status: "not-started"
---

# Prompt 3: Creator UI for Skill Pricing

## Objective
Create a user interface in the agent editor that allows creators to view their agent's skills and set a price for each one.

## Explanation
To enable skill monetization, creators need a simple and intuitive way to manage the prices of their skills. This task involves adding a new section to the `agent-edit.html` page. This section will list all the skills associated with the agent and provide input fields for setting a price and selecting a currency.

## Instructions
1.  **Locate the agent editor page:** Open the `agent-edit.html` file.
2.  **Add a new "Skill Pricing" section:** Find the area where skills are listed or managed. Add a new section with a clear heading like "Skill Monetization" or "Set Skill Prices".
3.  **Render skills with pricing inputs:**
    *   Iterate through the agent's skills.
    *   For each skill, display its name.
    *   Add an `input[type="number"]` for the price amount.
    *   Add a `select` dropdown to choose the currency (for now, we can hardcode USDC on Solana, but it should be extensible).
    *   Add a "Save Prices" button.
4.  **Fetch existing prices:** When the page loads, the frontend should fetch the agent's details, including any already-saved skill prices, and populate the input fields with the current values.
5.  **Style the new section:** Ensure the new UI elements are well-styled and fit seamlessly into the existing design of the agent editor.

## Code Example (HTML in `agent-edit.html`)

```html
<!-- Inside the main form or a relevant section of agent-edit.html -->
<div class="panel">
    <h3>Skill Monetization</h3>
    <p class="note">Set a price for your skills. Leave blank for free skills. Prices are set in USDC.</p>
    <div id="skill-pricing-list">
        <!-- Skills will be dynamically rendered here by JavaScript -->
    </div>
    <div class="action-row">
        <button type="button" class="btn-primary" id="save-prices-btn">Save Prices</button>
    </div>
    <p id="save-prices-status" class="form-status" hidden></p>
</div>
```

## Code Example (JavaScript for `agent-edit.html`)

```javascript
// In the script that manages agent-edit.html

function renderSkillPricer(agent) {
    const container = document.getElementById('skill-pricing-list');
    const skills = agent.manifest?.skills || [];
    const prices = agent.skill_prices || {};

    if (!skills.length) {
        container.innerHTML = '<p class="note">This agent has no skills to price.</p>';
        return;
    }

    container.innerHTML = skills.map(skill => {
        const skillId = skill.name || 'unknown-skill';
        const currentPrice = prices[skillId];
        const amount = currentPrice ? (currentPrice.amount / 1e6).toFixed(2) : ''; // Assuming 6 decimal places for USDC

        return `
            <div class="skill-price-row" data-skill-id="${escapeHtml(skillId)}">
                <span class="skill-name">${escapeHtml(skillId)}</span>
                <div class="price-input-wrap">
                    <input type="number" class="price-input" min="0" step="0.01" placeholder="Free" value="${amount}">
                    <span class="currency-label">USDC</span>
                </div>
            </div>
        `;
    }).join('');
}

// Add event listener for the save button to collect and POST the data.
document.getElementById('save-prices-btn').addEventListener('click', async () => {
    // ... logic to collect prices from inputs and call the backend API ...
});
```
