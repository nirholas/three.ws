---
status: not-started
---

# Prompt 4: Frontend - UI for Creators to Set Skill Prices

**Status:** Not Started

## Objective
Implement a user interface in the agent creation/editing page (`agent-edit.html`) that allows creators to set and view prices for their skills.

## Explanation
To make the pricing API useful, creators need a user-friendly interface to manage their skill prices. This involves adding form elements to the page where they edit their agent's details. This UI will fetch existing prices and provide input fields to set new ones, calling the API endpoint from the previous prompt.

## Instructions
- [ ] **Locate the Agent Edit Page:** Open the `agent-edit.html` file and its corresponding JavaScript file (e.g., `src/agent-edit.js`).
- [ ] **Fetch Existing Prices:** When the page loads and fetches the agent's details, make sure the API response includes the `skill_prices` data.
- [ ] **Modify the Skill Rendering:** In the area where the agent's skills are listed, add input fields for `amount` and `currency_mint` next to each skill.
- [ ] **Populate Existing Data:** If a price already exists for a skill, populate the input fields with that data.
- [ ] **Create a "Save Prices" Button:** Add a button that, when clicked, will gather the pricing data from all the input fields.
- [ ] **Implement the API Call:**
    - For each skill with a price, call the `POST /api/agents/:id/skills/pricing` endpoint.
    - You can do this individually for each skill or batch them into a single request if your backend supports it.
    - Provide user feedback (e.g., a "Saved!" message or an error notification).

## Code Example (`src/agent-edit.js`)

```javascript
// Inside the function that renders the agent details for editing

function renderAgentForEditing(agent) {
  // ... existing code to render agent name, description, etc.

  const skillsContainer = document.getElementById('skills-editor');
  const skillPrices = agent.skill_prices || {};

  skillsContainer.innerHTML = agent.skills.map(skill => {
    const price = skillPrices[skill.name] || {};
    const amountInUnits = price.amount ? price.amount / 1e6 : ''; // Example for USDC (6 decimals)
    const currency = price.currency_mint || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6T'; // Default to USDC

    return `
      <div class="skill-price-editor" data-skill-name="${skill.name}">
        <span class="skill-name">${skill.name}</span>
        <input type="number" class="price-amount" placeholder="e.g., 2.50" value="${amountInUnits}">
        <select class="price-currency">
          <option value="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6T" ${currency === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6T' ? 'selected' : ''}>USDC</option>
          <option value="So11111111111111111111111111111111111111112" ${currency === 'So11111111111111111111111111111111111111112' ? 'selected' : ''}>SOL</option>
        </select>
      </div>
    `;
  }).join('');
}

// Add event listener for the "Save Prices" button
document.getElementById('save-prices-btn').addEventListener('click', async () => {
  const agentId = /* get agent id from somewhere */;
  const editors = document.querySelectorAll('.skill-price-editor');
  
  for (const editor of editors) {
    const skill_name = editor.dataset.skillName;
    const amountInUnits = parseFloat(editor.querySelector('.price-amount').value);
    const currency_mint = editor.querySelector('.price-currency').value;

    if (!isNaN(amountInUnits) && amountInUnits > 0) {
      const amount = Math.round(amountInUnits * 1e6); // Convert back to smallest unit
      
      await fetch(`/api/agents/${agentId}/skills/pricing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', /* + auth headers */ },
        body: JSON.stringify({ skill_name, amount, currency_mint }),
      });
    }
  }
  // Show feedback to user
  alert('Prices saved!');
});
```
