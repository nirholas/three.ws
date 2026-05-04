# Prompt 14: UI for Subscription Tiers

## Objective
Implement the UI in the creator's dashboard that allows them to create, view, and manage subscription tiers for their agents.

## Explanation
Building on the subscription database schema, we now need a user interface for creators. This UI will live in the "Monetization" tab and will provide a form to define a new subscription tier (name, price, included skills) and a list to display existing tiers.

## Instructions
1.  **Add UI Structure:**
    *   In `agent-edit.html`, within the "Monetization" tab panel, add a new section for "Subscription Tiers".
    *   This section should contain a button "Create New Tier" which reveals a form.
    *   Also, include a container to list the existing tiers, e.g., `#subscription-tiers-list`.

2.  **Create Tier Form:**
    *   The form should have inputs for tier `name`, `description`, `price`, `currency`, and `billing interval` (monthly/yearly).
    *   A crucial part will be a multi-select box or a list of checkboxes for the creator to choose which of the agent's skills are included in this tier.

3.  **Frontend Logic:**
    *   In `src/agent-edit.js`, write a function to fetch the agent's skills and existing subscription tiers.
    *   Populate the skills multi-select in the form.
    *   Render the list of existing tiers with an "Edit" or "Deactivate" button for each.
    *   Handle the form submission to collect the data for a new tier, which will be sent to the backend (to be created in the next prompt).

## HTML Example (`agent-edit.html`)

```html
<!-- Inside the 'monetization' tab-content -->
<div class="card">
    <h3>Subscription Tiers</h3>
    <div id="subscription-tiers-list">
        <!-- Existing tiers will be rendered here -->
    </div>
    <button id="show-create-tier-form-btn">Create New Tier</button>
    <div id="create-tier-form-container" style="display:none;">
        <h4>New Subscription Tier</h4>
        <div class="form-field">
            <label for="tier-name">Tier Name</label>
            <input type="text" id="tier-name" placeholder="e.g., Pro">
        </div>
        <div class="form-field">
            <label for="tier-price">Price</label>
            <input type="number" id="tier-price" placeholder="9.99">
            <select id="tier-currency">
                <option value="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6d">USDC</option>
            </select>
            <select id="tier-interval">
                <option value="month">per month</option>
                <option value="year">per year</option>
            </select>
        </div>
        <div class="form-field">
            <label>Included Skills</label>
            <div id="tier-skills-checklist">
                <!-- Checkboxes for skills will be rendered here -->
            </div>
        </div>
        <button id="save-tier-btn">Save Tier</button>
        <button id="cancel-create-tier-btn" type="button">Cancel</button>
    </div>
</div>
```

## JavaScript Example (`src/agent-edit.js`)

```javascript
const showCreateTierBtn = document.getElementById('show-create-tier-form-btn');
const createTierContainer = document.getElementById('create-tier-form-container');
const saveTierBtn = document.getElementById('save-tier-btn');

showCreateTierBtn.addEventListener('click', () => {
    createTierContainer.style.display = 'block';
    showCreateTierBtn.style.display = 'none';
    populateSkillsForTierForm(); // a function that fetches and renders skills as checkboxes
});

saveTierBtn.addEventListener('click', async () => {
    const tierData = {
        name: document.getElementById('tier-name').value,
        price_amount: Math.round(parseFloat(document.getElementById('tier-price').value) * 1e6),
        price_currency_mint: document.getElementById('tier-currency').value,
        billing_interval: document.getElementById('tier-interval').value,
        included_skills: Array.from(document.querySelectorAll('#tier-skills-checklist input:checked')).map(cb => cb.value)
    };
    
    const agentId = /* get agent id from context */;
    // Backend call will be implemented next
    await createSubscriptionTier(agentId, tierData);
});
```
