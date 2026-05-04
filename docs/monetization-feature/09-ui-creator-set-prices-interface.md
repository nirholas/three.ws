---
status: not-started
---

# Prompt 9: UI - Creator-Facing "Set Prices" Interface

**Status:** Not Started

## Objective
Create a user interface for agent creators to set and manage prices for their skills.

## Explanation
To enable skill monetization, creators need a way to specify which of their skills are for sale and at what price. This task involves creating a new section in the agent editing interface where a creator can view their agent's skills and set a price for each one. This will be a new page or a new tab in the existing `agent-edit.html`.

## Instructions
1.  **Create the UI component:**
    - In `agent-edit.html`, add a new tab for "Monetization" or "Skill Pricing."
    - This panel should fetch and display a list of the agent's skills (from the `capabilities.skills` object in the agent's data).
    - For each skill, display its name and an input field for the price.

2.  **Design the pricing input:**
    - The price input should be a number field.
    - Add a currency selector (for now, you can default to USDC, but a dropdown would be better for the future).
    - Include a "Save Prices" button.

3.  **Handle data fetching:**
    - When the panel loads, it should fetch the current skill prices for the agent from a new backend endpoint (which you'll create in the next step). This ensures that existing prices are displayed for editing.

4.  **Handle saving:**
    - When the "Save Prices" button is clicked, collect the pricing data from all the input fields.
    - Send this data to a new backend endpoint (`/api/agents/:id/skill-prices`) that will save the prices to the `agent_skill_prices` table.

## Code Example (HTML in `agent-edit.html`)

```html
<!-- Inside the new "Monetization" tab panel -->
<div class="edit-panel" id="monetization-panel">
    <h3>Skill Pricing</h3>
    <p>Set prices for your skills in USDC. Leave the price as 0 for free skills.</p>
    <div id="skill-pricing-list">
        <!-- Skills will be dynamically rendered here -->
    </div>
    <button id="save-prices-btn">Save Prices</button>
</div>
```

## Code Example (JavaScript to render the pricing list)

```javascript
// In your agent editing script

async function renderSkillPricing(agentId) {
    const agent = await fetchAgentData(agentId); // Assumes you have this
    const skills = agent.capabilities.skills || [];
    const prices = await fetchSkillPrices(agentId); // You'll build this endpoint

    const listEl = document.getElementById('skill-pricing-list');
    listEl.innerHTML = skills.map(skill => {
        const price = prices[skill.name] || { amount: 0, currency_mint: 'USDC' };
        const priceInUSDC = price.amount / 1e6;

        return `
            <div class="skill-price-entry">
                <span class="skill-name">${skill.name}</span>
                <input type="number" class="price-input" data-skill-name="${skill.name}" value="${priceInUSDC}" min="0" step="0.01">
                <span class="currency-label">USDC</span>
            </div>
        `;
    }).join('');
}
```

## Verification
- Navigate to the agent edit page.
- Verify that the new "Monetization" tab is present.
- Check that it correctly lists the agent's skills.
- Ensure that price input fields and a "Save" button are visible.
- The save functionality will be verified after the next prompt's task (creating the backend endpoint) is complete.
