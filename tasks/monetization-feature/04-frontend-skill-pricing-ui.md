---
status: completed
---

# Prompt 4: Frontend - UI for Skill Price Management

## Objective
Create a user interface in the agent editor page for creators to set and manage the prices of their skills.

## Explanation
To complement the backend API for setting skill prices, we need a user-friendly interface for creators. This UI will be part of the agent editor, likely in a new "Monetization" or "Skills" tab. It will list the agent's skills and provide input fields for creators to set the price for each one.

## Instructions
1.  **Locate the Agent Editor:**
    *   Find the main agent editor component, likely in `agent-edit.html` and its corresponding JavaScript file.

2.  **Add a "Monetization" Tab:**
    *   Add a new tab to the agent editor for managing monetization settings.
    *   Inside this tab, fetch and display a list of the agent's skills.

3.  **Create the Pricing Form:**
    *   For each skill, display a form with:
        *   An input field for the `amount`.
        *   A dropdown (`<select>`) for the `currency_mint` (e.g., pre-populated with USDC, BONK, etc.).
        *   A "Save" button.
    *   When the creator saves a price, make a `POST` request to the API endpoint created in the previous prompt (`/api/agents/:agentId/skills/:skillId/price`).
    *   Display feedback to the user on success or failure (e.g., a "Saved!" message or an error alert).

## Code Example (Frontend - `agent-edit.html` structure)

```html
<!-- Inside the agent editor's tab panel -->
<div id="monetization-panel" class="edit-panel">
  <h2>Skill Pricing</h2>
  <div id="skill-list-pricing">
    <!-- Skills will be dynamically rendered here -->
  </div>
</div>
```

## Code Example (Frontend - JavaScript logic)

```javascript
// Inside the agent editor's JavaScript file

function renderSkillPricing(skills, agentId) {
  const container = document.getElementById('skill-list-pricing');
  container.innerHTML = skills.map(skill => `
    <div class="skill-price-row">
      <span class="skill-name">${escapeHtml(skill.name)}</span>
      <div class="price-inputs">
        <input type="number" class="price-amount" placeholder="e.g., 1.99" data-skill-id="${skill.id}">
        <select class="price-currency" data-skill-id="${skill.id}">
          <option value="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v">USDC</option>
          <option value="DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263">BONK</option>
        </select>
        <button class="save-price-btn" data-skill-id="${skill.id}">Save</button>
      </div>
    </div>
  `).join('');

  container.addEventListener('click', async (e) => {
    if (e.target.matches('.save-price-btn')) {
      const skillId = e.target.dataset.skillId;
      const amountInput = container.querySelector(`.price-amount[data-skill-id="${skillId}"]`);
      const currencySelect = container.querySelector(`.price-currency[data-skill-id="${skillId}"]`);
      
      const amount = parseFloat(amountInput.value) * 1e6; // Convert to lamports
      const currency_mint = currencySelect.value;

      // Make API call to POST /api/agents/${agentId}/skills/${skillId}/price
      // ... handle success/error and show feedback ...
    }
  });
}
```
