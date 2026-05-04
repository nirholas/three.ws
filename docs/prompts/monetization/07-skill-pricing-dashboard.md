---
status: not-started
---
# Prompt 7: Skill Pricing Dashboard for Creators

## Objective
Create a dashboard for agent creators to view their skills and set or update prices for them.

## Explanation
To create a functioning marketplace, we need to empower creators. This prompt focuses on building the user interface where a creator can manage the monetization of their agent's skills.

## Instructions
1.  **Create Creator Dashboard Page:**
    *   In the user dashboard area, create a new section or page accessible to users who have created agents, titled "My Agents & Skills".
    *   This page should list all the agents created by the current user.

2.  **Agent Skill Management UI:**
    *   For each agent listed, provide a "Manage Skills" button.
    *   Clicking this button should lead to a view that lists all skills associated with that agent.
    *   Next to each skill, display its current price (or "Not for sale") and an "Edit Price" button.

3.  **Price Editing Modal:**
    *   Clicking "Edit Price" should open a modal.
    *   The modal should contain a form with an input for the price and a dropdown for the currency (initially, only USDC on Solana).
    *   The form should handle both setting a price for a new skill and updating an existing one.
    *   Include a "Remove from sale" button to make a skill free again.

4.  **Backend API for Pricing:**
    *   Create a secure backend endpoint, e.g., `POST /api/agents/:agentId/skills/price`.
    *   The endpoint must verify that the authenticated user is the owner of the agent.
    *   It should accept `skillName`, `amount`, and `currencyMint` as input.
    *   This endpoint will `INSERT` or `UPDATE` a record in the `agent_skill_prices` table. If the amount is set to 0 or null, the existing price record should be deleted.

## Code Example (Frontend - Price Edit Modal)
```html
<div id="price-edit-modal" class="modal">
    <div class="modal-content">
        <span class="close-button">&times;</span>
        <h3>Set Price for <span id="modal-skill-name"></span></h3>
        <form id="price-form">
            <input type="hidden" id="modal-agent-id">
            <div class="form-group">
                <label for="price-amount">Price</label>
                <input type="number" id="price-amount" step="0.01" min="0" required>
            </div>
            <div class="form-group">
                <label for="price-currency">Currency</label>
                <select id="price-currency" disabled>
                    <option value="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7uVv">USDC (Solana)</option>
                </select>
            </div>
            <div class="form-actions">
                <button type="submit" class="btn-primary">Save Price</button>
                <button type="button" id="remove-price-btn" class="btn-danger">Remove from Sale</button>
            </div>
        </form>
    </div>
</div>
```
