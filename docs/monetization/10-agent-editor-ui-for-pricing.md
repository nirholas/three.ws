# Prompt 10: Create Agent Creation/Editing UI for Pricing

## Status
- [ ] Not Started

## Objective
Develop a user interface for agent creators to set and manage prices for their agent's skills.

## Explanation
For creators to monetize their work, they need a simple way to define which skills are for sale and at what price. This prompt focuses on building the UI for this purpose in the agent creation or editing page.

## Instructions
1.  **Locate the Agent Editor:**
    *   Find the HTML and JavaScript files responsible for the agent creation/editing form (e.g., `agent-edit.html` and `src/agent-editor.js`).

2.  **Enhance the Skills Section:**
    *   In the part of the form where skills are listed or added, add new input fields next to each skill.
    *   The new fields should be for:
        *   `Price`: A number input for the skill's price.
        *   `Currency`: A dropdown/select input to choose the payment currency (e.g., USDC, SOL).

3.  **Manage State:**
    *   The JavaScript for the editor needs to manage this new pricing data.
    *   When the form is loaded for an existing agent, it should be populated with the current skill prices.
    *   As the creator changes the prices, the state should be updated.

4.  **Handle Form Submission:**
    *   When the agent creator saves their changes, the pricing information should be collected and sent to the backend.
    *   The data should be structured in a way that's easy for the backend to process, e.g., an object where keys are skill names.

## Code Example (HTML in `agent-edit.html`)
```html
<div id="skills-editor">
  <!-- This part will be dynamically populated by JavaScript -->
</div>

<template id="skill-editor-template">
  <div class="skill-price-row">
    <input type="text" class="skill-name-input" placeholder="Skill Name" readonly>
    <input type="number" class="skill-price-input" placeholder="Price">
    <select class="skill-currency-select">
      <option value="USDC_MINT_ADDRESS">USDC</option>
      <option value="SOL_MINT_ADDRESS">SOL</option>
      <!-- Add other supported currencies -->
    </select>
  </div>
</template>
```

## Code Example (JavaScript in `src/agent-editor.js`)
```javascript
function renderSkillPricer(skills, currentPrices) {
  const container = document.getElementById('skills-editor');
  const template = document.getElementById('skill-editor-template');
  container.innerHTML = '';

  skills.forEach(skillName => {
    const skillRow = template.content.cloneNode(true);
    const price = currentPrices[skillName];
    
    skillRow.querySelector('.skill-name-input').value = skillName;
    if (price) {
      skillRow.querySelector('.skill-price-input').value = price.amount / 1e6; // Display in human-readable format
      skillRow.querySelector('.skill-currency-select').value = price.currency_mint;
    }

    container.appendChild(skillRow);
  });
}

function getSkillPricesFromForm() {
  const prices = {};
  document.querySelectorAll('#skills-editor .skill-price-row').forEach(row => {
    const name = row.querySelector('.skill-name-input').value;
    const amountInput = row.querySelector('.skill-price-input').value;
    const currency = row.querySelector('.skill-currency-select').value;
    
    if (amountInput && parseFloat(amountInput) > 0) {
      prices[name] = {
        amount: parseFloat(amountInput) * 1e6, // Convert to smallest unit
        currency_mint: currency
      };
    }
  });
  return prices;
}

// On save/submit:
const updatedPrices = getSkillPricesFromForm();
// Now, send 'updatedPrices' to the backend.
```
