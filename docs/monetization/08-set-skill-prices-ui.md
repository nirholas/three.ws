# Prompt 8: "Set Skill Prices" UI

## Objective
Create a user interface within the agent creation/editing page (`agent-edit.html`) that allows creators to set prices for their agent's skills.

## Explanation
To enable monetization, creators need a simple and intuitive way to manage the prices of their skills. This task involves building the UI components (input fields, selectors) where a creator can assign a price and currency to each skill associated with their agent.

## Instructions
1.  **Modify Agent Edit Page (`agent-edit.html`):**
    *   Locate the section where skills are listed or added for an agent.
    *   For each skill listed, add input fields for `price` and a dropdown for `currency`.

2.  **Structure the UI:**
    *   The UI should be clear. Next to each skill name, add:
        *   An `<input type="number">` for the price. It should have `step="0.01"` and `min="0"` for decimal values.
        *   A `<select>` dropdown for the currency. Initially, this can be hardcoded to just "USDC". In the future, it could be populated with other SPL tokens.
        *   A "Save Prices" button at the end of the section.

3.  **Fetch Existing Prices:**
    *   When the agent edit page loads, it fetches the agent's data. This data should now include any previously saved skill prices.
    *   The UI should be populated with these existing prices when the page loads.

## HTML Example (Inside `agent-edit.html`)

```html
<!-- Inside the form for editing an agent -->
<div id="skills-pricing-section">
    <h3>Monetize Skills</h3>
    <p>Set a price for your skills. Leave the price as 0 for a free skill.</p>
    <div id="skill-price-list">
        <!-- This list will be populated dynamically by JavaScript -->
    </div>
    <button type="button" id="save-skill-prices-btn">Save Prices</button>
</div>
```

## JavaScript for Rendering (`src/agent-edit.js`)

```javascript
// Function to render the skill price inputs
function renderSkillPricing(agent) {
    const skills = agent.skills || [];
    const prices = agent.skill_prices || {};
    const container = document.getElementById('skill-price-list');

    if (!skills.length) {
        container.innerHTML = '<p>Add skills to your agent to set their prices.</p>';
        return;
    }

    container.innerHTML = skills.map(skill => {
        const skillName = skill.name || skill;
        const price = prices[skillName] ? (prices[skillName].amount / 1e6) : 0;
        const currency = prices[skillName] ? prices[skillName].currency_mint : 'USDC';

        return `
            <div class="skill-price-entry" data-skill-name="${escapeHtml(skillName)}">
                <label for="price-${escapeHtml(skillName)}">${escapeHtml(skillName)}</label>
                <input 
                    type="number" 
                    id="price-${escapeHtml(skillName)}" 
                    class="skill-price-input" 
                    value="${price}"
                    min="0" 
                    step="0.01" 
                    placeholder="e.g., 1.99"
                />
                <select class="skill-currency-select">
                    <option value="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6d" ${currency === 'USDC' ? 'selected' : ''}>USDC</option>
                    <!-- Other currencies can be added later -->
                </select>
            </div>
        `;
    }).join('');
}

// In your page load logic:
// const agentData = await fetchAgentData(agentId);
// renderSkillPricing(agentData);
```

## CSS for Styling

```css
.skill-price-entry {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.skill-price-entry label {
  flex: 1;
  font-weight: 500;
}
.skill-price-input, .skill-currency-select {
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--panel);
}
```
