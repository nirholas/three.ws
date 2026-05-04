# Prompt 3: UI for Skill Price Management

## Objective
Create a user interface within the agent editing page that allows creators to easily set, update, and remove prices for their skills.

## Explanation
With the backend API in place, creators need a visual tool to manage their skill pricing. This UI will be added to the `agent-edit.html` page, providing an intuitive way to toggle a skill as "paid" and set its price without needing to interact with the API directly.

## Instructions
1.  **Locate the Correct File:**
    *   Open `agent-edit.html`. This page contains the forms for editing an agent's properties.

2.  **Add a "Monetization" Section:**
    *   Find where skills or agent profile prompts are rendered. This is likely in the "Publish" tab (`id="panel-publish"`).
    *   Add a new section for skill pricing. You could list the agent's available skills (fetched from the agent's metadata) and provide pricing controls for each.

3.  **Implement UI Controls for Each Skill:**
    *   For each skill, display its name.
    *   Add a checkbox or toggle switch labeled "Paid Skill".
    *   When the "Paid Skill" toggle is enabled, show two input fields:
        *   An `input type="number"` for the `amount` (in a user-friendly unit like USDC, not lamports).
        *   A (potentially hidden or disabled) field for the `currency_mint`, which could default to USDC for now.
    *   When the toggle is disabled, hide the price inputs.

4.  **Handle Form Submission:**
    *   When the creator saves their changes on the `agent-edit` page, your JavaScript should gather the pricing data for each skill.
    *   For each skill that is marked as "paid", make a call to the `POST /api/agents/:id/skills/price` endpoint created in the previous prompt.
    *   Remember to convert the user-friendly amount (e.g., 1.5 USDC) back to the base unit (e.g., 1,500,000 lamports for a 6-decimal currency) before sending it to the API.
    *   If a skill is marked as free (or was paid and is now free), send a request with `amount: 0` to remove the price.

## Code Example (Frontend - `agent-edit.html` script)

```javascript
// Inside the script tag of agent-edit.html

// Assume 'agent.skills' is an array of skill names and 'currentPrices' is a map from the API
function renderSkillPricingUI(skills, currentPrices) {
    const container = document.getElementById('skill-pricing-container'); // You'll need to create this container
    container.innerHTML = '<h3>Skill Pricing</h3>';

    skills.forEach(skillName => {
        const price = currentPrices[skillName];
        const isPaid = !!price;
        const amountInUSDC = isPaid ? (price.amount / 1e6).toFixed(2) : '1.00';

        const skillRow = document.createElement('div');
        skillRow.className = 'form-group skill-price-row';
        skillRow.innerHTML = `
            <label class="form-label">${escapeHtml(skillName)}</label>
            <div class="skill-price-controls">
                <input type="checkbox" class="paid-toggle" data-skill="${escapeHtml(skillName)}" ${isPaid ? 'checked' : ''}>
                <span class="toggle-label">Paid</span>
                <div class="price-inputs" style="${isPaid ? '' : 'display: none;'}">
                    <input type="number" class="price-amount" value="${amountInUSDC}" step="0.01" min="0">
                    <span>USDC</span>
                </div>
            </div>
        `;
        container.appendChild(skillRow);
    });

    // Add event listeners for toggles
    container.querySelectorAll('.paid-toggle').forEach(toggle => {
        toggle.addEventListener('change', (e) => {
            const inputs = e.target.closest('.skill-price-controls').querySelector('.price-inputs');
            inputs.style.display = e.target.checked ? 'flex' : 'none';
        });
    });
}

// On save, you would iterate through these controls:
async function saveSkillPrices(agentId) {
    const rows = document.querySelectorAll('.skill-price-row');
    for (const row of rows) {
        const toggle = row.querySelector('.paid-toggle');
        const skillName = toggle.dataset.skill;
        const amountInput = row.querySelector('.price-amount');
        
        let amountInLamports = 0;
        if (toggle.checked) {
            const amountInUSDC = parseFloat(amountInput.value);
            if (!isNaN(amountInUSDC) && amountInUSDC > 0) {
                amountInLamports = Math.round(amountInUSDC * 1e6); // Convert to lamports
            }
        }
        
        await fetch(`/api/agents/${agentId}/skills/price`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                skill_name: skillName,
                amount: amountInLamports,
                currency_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' // Assuming USDC
            })
        });
    }
}
```
