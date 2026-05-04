---
status: completed
---
# Prompt 2: Creator UI to Set Skill Prices

**Status:** Not Started

## Objective
Enhance the agent creation/editing page (`agent-edit.html`) to allow creators to set prices for their custom skills.

## Explanation
For creators to monetize their work, they need a simple interface to manage skill pricing. This task involves adding a new section to the agent editor that lists the agent's skills and provides input fields for setting a price in USDC. We will focus on USDC on Solana for now.

## Instructions
1.  **Locate the Agent Editor:**
    -   Find the agent editor page, likely `agent-edit.html`.
    -   Identify the section where agent skills are listed or managed.

2.  **Enhance the Skills UI:**
    -   For each skill listed, add an input field for the price.
    -   The input should be clearly labeled (e.g., "Price (USDC)").
    -   Include a toggle or checkbox to mark a skill as "Paid". When enabled, the price input should appear.
    -   Add a "Save Prices" button to submit the changes.

3.  **Implement Frontend Logic:**
    -   In the corresponding JavaScript file (likely `src/agent-edit.js` or similar), add an event listener to the "Save Prices" button.
    -   When clicked, collect the pricing data for all skills. The data should be in a format like `[{ skill_name: "...", amount: 500000, currency: "USDC" }, ...]`. Note: 0.5 USDC = 500,000 lamports (assuming 6 decimals for USDC).
    -   Send this data to a new backend API endpoint (which will be created in the next prompt).

## Code Example (HTML in `agent-edit.html`)

This is a conceptual example of how the skill pricing inputs could be structured.

```html
<!-- Inside the skills management section -->
<div class="skill-list">
  <div class="skill-item">
    <span class="skill-name">PumpFun Tools</span>
    <div class="skill-pricing-controls">
      <label class="toggle-switch">
        <input type="checkbox" class="price-toggle" data-skill="PumpFun Tools">
        <span class="slider"></span>
      </label>
      <div class="price-input-wrapper" style="display: none;">
        <input type="number" class="price-input" min="0" step="0.01" placeholder="0.50">
        <span>USDC</span>
      </div>
    </div>
  </div>
  <!-- ... more skills ... -->
</div>
<button id="save-skill-prices-btn">Save Prices</button>
```

## JavaScript Example (`src/agent-edit.js`)

```javascript
// Add event listener for the save button
document.getElementById('save-skill-prices-btn').addEventListener('click', async () => {
  const prices = [];
  document.querySelectorAll('.skill-item').forEach(item => {
    const name = item.querySelector('.skill-name').textContent;
    const toggle = item.querySelector('.price-toggle');
    const input = item.querySelector('.price-input');
    
    if (toggle.checked && input.value) {
      const amountInLamports = parseFloat(input.value) * 1e6; // Convert USDC to lamports
      prices.push({
        skill_name: name,
        amount: amountInLamports,
        currency_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6a' // USDC mint on Solana
      });
    }
  });

  // POST to the new backend endpoint
  await fetch(`/api/agents/${agentId}/skill-prices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prices })
  });

  // Show a confirmation to the user
  alert('Prices saved!');
});
```
