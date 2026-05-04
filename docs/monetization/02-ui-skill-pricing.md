---
status: not-started
---

# Prompt 2: UI for Setting Skill Prices

## Objective
Create a UI in the agent edit page (`agent-edit.html`) for creators to set prices for their skills.

## Explanation
To sell skills, creators need an intuitive interface to manage pricing. This will involve adding a new section to the agent editor where they can input a price and select a currency for each skill associated with their agent. This prompt focuses only on creating the frontend UI components.

## Instructions
1.  **Identify the Agent Editor:** Locate the files responsible for the agent creation/editing page (e.g., `agent-edit.html` and its corresponding JavaScript).
2.  **Add a New UI Section:** In the HTML, add a new section titled "Skill Pricing". This section should contain a list or form where skills will be dynamically rendered.
3.  **Dynamically Render Skills:** In the page's JavaScript, fetch the agent's currently defined skills. For each skill, render a row in the "Skill Pricing" section.
4.  **Add Input Fields:** Each skill row should include:
    *   The skill name (as static text).
    *   A number input field for the price.
    *   A dropdown (`<select>`) to choose the currency. Initially, this can be hardcoded to just "USDC".
5.  **Add a Save Button:** Include a "Save Prices" button at the bottom of the section. Its functionality will be implemented in a subsequent step.
6.  **Load Existing Prices:** The script should also fetch and display any previously saved prices for the skills in the input fields.

## Code Example (HTML in `agent-edit.html`)

```html
<!-- Inside the main form of the agent editor -->
<div class="form-section">
  <h2>Skill Pricing</h2>
  <p class="description">Set prices for individual skills. Leave blank for free skills.</p>
  <div id="skill-pricing-list">
    <!-- Skills will be rendered here by JavaScript -->
  </div>
  <button type="button" id="save-prices-btn" class="cta-button">Save Prices</button>
</div>
```

## Code Example (JavaScript logic)

```javascript
// Function to render the pricing UI
function renderSkillPricer(agent) {
  const skills = agent.skills || [];
  const prices = agent.skill_prices || {};
  const container = document.getElementById('skill-pricing-list');

  if (skills.length === 0) {
    container.innerHTML = '<p>Add skills to this agent to set prices.</p>';
    return;
  }

  container.innerHTML = skills.map(skill => {
    const skillName = skill.name || skill;
    const price = prices[skillName];
    const amount = price ? (price.amount / 1e6).toFixed(2) : '';
    // Note: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7uP3' is the mint for USDC on Solana Mainnet
    return `
      <div class="skill-price-row">
        <span class="skill-name">${escapeHtml(skillName)}</span>
        <input type="number" class="price-input" data-skill="${escapeHtml(skillName)}" value="${amount}" placeholder="0.00">
        <select class="currency-select" data-skill-currency="${escapeHtml(skillName)}">
          <option value="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7uP3">USDC</option>
        </select>
      </div>
    `;
  }).join('');
}
```
