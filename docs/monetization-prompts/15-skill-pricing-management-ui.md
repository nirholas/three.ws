---
status: not-started
---

# Prompt 15: Skill Pricing Management - UI

## Objective
Create a user interface on the agent creation/editing page that allows creators to set and update prices for their skills.

## Explanation
Creators need a simple and intuitive way to manage the prices of their skills. This involves adding new form elements to the page where they configure their agents.

## Instructions
- [ ] **Design the UI:**
    - [ ] On the page where a creator edits their agent (e.g., `agent-edit.html`), locate the section where skills are listed or added.
    - [ ] For each skill listed, add a price input field and a currency selector (for now, this can be a disabled dropdown showing "USDC").
    - [ ] If a skill is meant to be free, the creator should be able to leave the price field blank or set it to 0.
    - [ ] Add a "Save Prices" or "Update Agent" button to submit the changes.

- [ ] **Implement Frontend Logic:**
    - [ ] When the agent edit page loads, it should fetch the agent's details, including the existing `skill_prices` map.
    - [ ] Use this data to populate the price input fields for each skill.
    - [ ] When the "Save" button is clicked, gather all the skill names and their new prices from the input fields.
    - [ ] Structure this data into a map, e.g., `{ "skill_one": 10.50, "skill_two": 0 }`.
    - [ ] Make a `PUT` request to a new backend API endpoint to save these prices.

## HTML Example (Inside an agent edit form)

```html
<div id="skill-pricing-section">
  <h3>Manage Skill Prices</h3>
  
  <!-- This would be dynamically generated -->
  <div class="skill-price-entry">
    <label for="price-skill_one">Skill One</label>
    <input type="number" id="price-skill_one" name="skill_prices[skill_one]" placeholder="e.g., 5.00">
    <span>USDC</span>
  </div>

  <div class="skill-price-entry">
    <label for="price-skill_two">Skill Two</label>
    <input type="number" id="price-skill_two" name="skill_prices[skill_two]" placeholder="Leave blank for Free">
    <span>USDC</span>
  </div>

  <button id="save-prices-btn">Save Prices</button>
</div>
```

## JavaScript Example (on Save button click)

```javascript
document.getElementById('save-prices-btn').addEventListener('click', async () => {
    const prices = {};
    const agentId = /* get agent ID from page */;
    
    document.querySelectorAll('.skill-price-entry').forEach(entry => {
        const input = entry.querySelector('input[type="number"]');
        const skillName = input.name.match(/\[(.*?)\]/)[1]; // Extracts "skill_one"
        const price = parseFloat(input.value) || 0;
        
        // Convert to smallest unit (e.g., 1 USDC = 1,000,000)
        prices[skillName] = price * 1e6;
    });

    await fetch(`/api/agents/${agentId}/prices`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prices })
    });
    
    // Show success message
});
```
