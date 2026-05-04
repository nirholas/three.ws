# Prompt 9: Create an Admin Interface for Setting Skill Prices

**Status:** - [ ] Not Started

## Objective
Develop a UI for agent creators to set and manage prices for their agent's skills.

## Explanation
For creators to monetize their skills, they need an interface to specify which skills are for sale and at what price. This will likely be part of the agent editing page (`agent-edit.html`).

## Instructions
1.  **Create UI for Price Management:**
    *   In `agent-edit.html`, add a new section for "Skill Monetization".
    *   This section should list all the skills available for the agent.
    *   For each skill, provide input fields for:
        *   Price (e.g., in USDC).
        *   Currency (a dropdown, initially just supporting USDC).
        *   A "Set Price" or "Save" button.
    *   Also display the current price if one is set.

2.  **Develop Backend Endpoint for Setting Prices:**
    *   Create a new API endpoint, e.g., `api/agents/set-skill-price.js`.
    *   This must be an authenticated endpoint. Before processing, it must verify that the logged-in user is the creator of the agent.
    *   It should accept `agentId`, `skillName`, `amount`, and `currencyMint`.
    *   The handler will perform an `INSERT ... ON CONFLICT ... UPDATE` (or an "upsert") operation on the `agent_skill_prices` table for the given agent and skill.

3.  **Connect Frontend to Backend:**
    *   In the JavaScript for the agent edit page, add an event listener to the "Set Price" button.
    *   When clicked, it should gather the data from the input fields and make a `POST` request to the new API endpoint.
    *   Provide feedback to the user on success or failure.

## Code Example (HTML for `agent-edit.html`)

```html
<!-- In agent-edit.html, inside the agent form -->
<div class="form-section">
  <h3>Skill Monetization</h3>
  <div id="skill-pricing-list">
    <!-- Skills will be dynamically rendered here by JavaScript -->
  </div>
</div>
```

## Code Example (JavaScript for the agent edit page)

```javascript
// Function to render the skill pricing interface
function renderSkillPricing(agent) {
  const container = $('skill-pricing-list');
  container.innerHTML = agent.skills.map(skill => `
    <div class="skill-price-entry">
      <label>${escapeHtml(skill.name)}</label>
      <input type="number" placeholder="Price (USDC)" data-skill-name="${escapeHtml(skill.name)}" value="${(agent.skill_prices?.[skill.name]?.amount / 1e6) || ''}">
      <button class="set-price-btn" data-skill-name="${escapeHtml(skill.name)}">Save</button>
    </div>
  `).join('');
}

// Event listener for the save buttons
$('skill-pricing-list').addEventListener('click', async (e) => {
  if (e.target.classList.contains('set-price-btn')) {
    const skillName = e.target.dataset.skillName;
    const priceInput = document.querySelector(`input[data-skill-name="${skillName}"]`);
    const priceInUSDC = parseFloat(priceInput.value);

    if (isNaN(priceInUSDC) || priceInUSDC <= 0) {
      alert('Please enter a valid price.');
      return;
    }

    const amountInLamports = priceInUSDC * 1e6;
    
    // Call the backend
    const response = await fetch('/api/agents/set-skill-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: currentAgentId,
        skillName,
        amount: amountInLamports,
        currencyMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u1b', // USDC mint
      }),
    });

    if (response.ok) {
      showToast('Price updated!', 'success');
    } else {
      showToast('Failed to update price.', 'error');
    }
  }
});
```
