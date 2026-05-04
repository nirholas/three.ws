---
status: not-started
---

# Prompt 4: Frontend - Skill Pricing UI in Agent Editor

## Objective
Build a user interface within the agent editor page (`agent-edit.html`) that allows creators to view, add, and update prices for their agent's skills.

## Explanation
To make the new pricing API useful, creators need a friendly UI. This task involves adding a new section to the agent editor page. This section will list all of the agent's available skills and provide input fields for creators to set a price and currency for each one. The UI will then call the API endpoint created in the previous step to save the changes.

## Instructions
1.  **Locate the Agent Editor File:**
    *   Open the `agent-edit.html` file and its corresponding JavaScript file (e.g., `src/agent-edit.js`).

2.  **Design the UI:**
    *   In `agent-edit.html`, add a new section titled "Skill Monetization" or "Skill Pricing".
    *   This section should dynamically render a list of the agent's skills.
    *   For each skill, display:
        *   The skill name (read-only).
        *   An input field for the price (`amount`).
        *   A dropdown or input field for the `currency_mint` (for now, you can default this to USDC's mint address).
        *   A "Save" or "Update" button for each skill, or a single "Save All Prices" button for the section.

3.  **Implement the Frontend Logic:**
    *   In `src/agent-edit.js`, when the agent data is loaded, populate the new UI section. You'll need to fetch the existing skill prices along with the agent details.
    *   Attach an event listener to the "Save" button(s).
    *   When a creator clicks "Save", gather the `skill_name`, `amount`, and `currency_mint` from the input fields.
    *   **Important:** The amount in the UI will be in a human-readable format (e.g., 1.00 USDC), but the API expects lamports. You must convert the UI value to the smallest unit before sending it to the API (e.g., `parseFloat(amountInput.value) * 1e6`).
    *   Make a `POST` request to the `/api/agents/[agentId]/skills/prices` endpoint with the data in the request body.
    *   Provide user feedback, such as a toast notification ("Price updated successfully!") or by changing the state of the save button (e.g., showing a checkmark).
    *   Handle any errors returned from the API and display a helpful message to the user.

## Code Example (HTML in `agent-edit.html`)

```html
<!-- Inside the agent editor form -->
<div class="form-section">
    <h3>Skill Pricing</h3>
    <p class="form-section-desc">
        Set prices for your agent's skills. Payments will be handled on Solana.
    </p>
    <div id="skill-pricing-list">
        <!-- Skills will be dynamically rendered here -->
    </div>
</div>
```

## Code Example (JavaScript in `src/agent-edit.js`)

```javascript
// Function to render the pricing UI
function renderSkillPricing(agent) {
    const skills = agent.skills || []; // Assuming agent.skills is an array of skill objects/names
    const prices = agent.skill_prices || {};
    const container = document.getElementById('skill-pricing-list');

    container.innerHTML = skills.map(skill => {
        const skillName = typeof skill === 'string' ? skill : skill.name;
        const price = prices[skillName];
        const amountInUSDC = price ? (price.amount / 1e6).toFixed(2) : '0.00';

        return `
            <div class="skill-price-entry" data-skill-name="${escapeHtml(skillName)}">
                <label>${escapeHtml(skillName)}</label>
                <div class="price-inputs">
                    <input type="number" step="0.01" min="0" value="${amountInUSDC}" class="price-amount-input">
                    <select class="price-currency-select">
                        <option value="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6T">USDC</option>
                    </select>
                    <button class="btn-save-price">Save</button>
                </div>
            </div>
        `;
    }).join('');

    // Add event listeners to all save buttons
    container.querySelectorAll('.btn-save-price').forEach(button => {
        button.addEventListener('click', handleSavePrice);
    });
}

// Event handler for saving a price
async function handleSavePrice(event) {
    const entry = event.target.closest('.skill-price-entry');
    const skillName = entry.dataset.skillName;
    const amountInput = entry.querySelector('.price-amount-input');
    const currencySelect = entry.querySelector('.price-currency-select');

    const amountInUSDC = parseFloat(amountInput.value);
    if (isNaN(amountInUSDC) || amountInUSDC < 0) {
        showToast('Invalid amount', 'error');
        return;
    }

    const payload = {
        skill_name: skillName,
        amount: Math.round(amountInUSDC * 1e6), // Convert to lamports
        currency_mint: currencySelect.value
    };

    try {
        const response = await fetch(`/api/agents/${currentAgentId}/skills/prices`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', /* ...auth headers */ },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const { error } = await response.json();
            throw new Error(error || 'Failed to save price');
        }

        showToast(`${skillName} price updated!`, 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}
```
