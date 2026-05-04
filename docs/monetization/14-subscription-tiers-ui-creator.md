---
status: not-started
---

# Prompt 14: Subscription Tiers UI for Creators

## Objective
Create a user interface in the agent edit page for creators to define and manage their subscription tiers.

## Explanation
Creators need a way to create, view, edit, and delete subscription tiers for their agents. This UI will allow them to set up their monetization strategy directly from the agent management dashboard.

## Instructions
1.  **Add a New UI Section in `agent-edit.html`:**
    *   Create a new section titled "Subscription Tiers".
    *   This section should have a button to "Create New Tier".
    *   It should also contain a list or table to display existing tiers for the agent.

2.  **Create a Tier Editor Modal:**
    *   Clicking "Create New Tier" (or "Edit" on an existing tier) should open a modal dialog.
    *   The modal form should contain input fields for all the properties of a subscription tier:
        *   Tier Name (text input)
        *   Description (textarea)
        *   Price (number input)
        *   Currency (select, e.g., USDC)
        *   Billing Interval (e.g., a select dropdown with "Monthly", "Yearly").
        *   Active (a checkbox/toggle)

3.  **Implement Frontend Logic:**
    *   Write JavaScript to fetch the agent's existing tiers and render them in the list.
    *   Each rendered tier should have "Edit" and "Delete" buttons.
    *   Implement the logic to show the modal and populate it with data when editing an existing tier, or show it empty for a new tier.
    *   The "Save" button in the modal will be wired up to the backend API in the next step.
    *   The "Delete" button should trigger a confirmation prompt before proceeding.

## Code Example (HTML in `agent-edit.html`)

```html
<div class="form-section">
  <h2>Subscription Tiers</h2>
  <div id="existing-tiers-list">
    <!-- Existing tiers will be rendered here -->
  </div>
  <button type="button" id="create-tier-btn" class="cta-button">+ Create New Tier</button>
</div>

<!-- Tier Editor Modal (hidden by default) -->
<div id="tier-editor-modal" class="modal-backdrop">
  <div class="modal-content">
    <div class="modal-header">
      <h3 id="tier-modal-title">Create Tier</h3>
    </div>
    <div class="modal-body">
      <input type="hidden" id="tier-id-input">
      <div class="form-group">
        <label for="tier-name">Tier Name</label>
        <input type="text" id="tier-name" placeholder="e.g., Supporter">
      </div>
      <div class="form-group">
        <label for="tier-description">Description</label>
        <textarea id="tier-description" placeholder="e.g., Access to exclusive content..."></textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="tier-price">Price</label>
          <input type="number" id="tier-price" placeholder="0.00">
        </div>
        <div class="form-group">
          <label for="tier-currency">Currency</label>
          <select id="tier-currency">
            <option value="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7uP3">USDC</option>
          </select>
        </div>
        <div class="form-group">
          <label for="tier-interval">Interval</label>
          <select id="tier-interval">
            <option value="month">Monthly</option>
            <option value="year">Yearly</option>
          </select>
        </div>
      </div>
    </div>
    <div class="modal-actions">
      <button id="cancel-tier-btn" type="button">Cancel</button>
      <button id="save-tier-btn" type="button" class="cta-button">Save Tier</button>
    </div>
  </div>
</div>
```

## Code Example (JavaScript Logic)

```javascript
// Renders the list of existing tiers
async function renderTiersList(agentId) {
  const response = await fetch(`/api/agents/${agentId}/tiers`);
  const tiers = await response.json();
  const container = document.getElementById('existing-tiers-list');

  container.innerHTML = tiers.map(tier => `
    <div class="tier-summary-row">
      <span>${escapeHtml(tier.name)} - ${(tier.price_amount / 1e6).toFixed(2)} USDC / ${tier.interval}</span>
      <div>
        <button onclick="openTierModal(${JSON.stringify(tier)})">Edit</button>
        <button onclick="deleteTier('${tier.id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

// Opens the modal for creating or editing a tier
function openTierModal(tier = null) {
  const modal = document.getElementById('tier-editor-modal');
  if (tier) {
    // Populate form with existing tier data for editing
    document.getElementById('tier-modal-title').textContent = 'Edit Tier';
    document.getElementById('tier-id-input').value = tier.id;
    // ... set other input values
  } else {
    // Clear form for creating a new tier
    document.getElementById('tier-modal-title').textContent = 'Create Tier';
    document.getElementById('tier-id-input').value = '';
    // ... clear other input values
  }
  modal.style.display = 'flex';
}
```
