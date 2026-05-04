# Prompt 15: Skill Pricing Management

## Objective
Create a UI in the creator dashboard that allows creators to set and update prices for their agent's skills.

## Explanation
Pricing needs to be dynamic. This feature empowers creators to manage their own economy by letting them add, change, and remove prices for their skills without needing to edit code or contact support.

## Instructions
1.  **Create Pricing UI:**
    *   In the "My Agents" tab of the dashboard, for each agent listed, add a "Manage Skills" button.
    *   Clicking this button should open a modal or a new page dedicated to that agent's skills.
    *   In this view, list all of the agent's available skills.
    *   Next to each skill, provide an input field for the price and a dropdown for the currency (e.g., USDC).
    *   Include a "Save Prices" button.

2.  **Backend API for Pricing:**
    *   Create a new backend endpoint, e.g., `/api/agents/:id/skill-prices`.
    *   This endpoint should accept a `PUT` or `POST` request with a body containing an object of skill prices, like `{ "skill_one": { "amount": 1000000, "currency": "USDC" }, "skill_two": ... }`.
    *   The endpoint should be secure, ensuring only the agent's owner can update its prices.

3.  **Database for Prices:**
    *   Create a new table, `agent_skill_prices`, with columns like `id`, `agent_id`, `skill_name`, `amount`, and `currency_mint`.
    *   The backend endpoint will `INSERT` or `UPDATE` rows in this table based on the incoming data.

4.  **Connect UI to API:**
    *   When the creator clicks "Save Prices," the frontend should gather the data from all the input fields and send it to the new backend endpoint.
    *   The page that displays prices to customers (`marketplace.html`) will need to be updated to fetch from this new table instead of a hardcoded source. This links back to Prompt 1.

## Code Example (UI Concept)
```html
<!-- Inside the "Manage Skills" modal -->
<h3>Manage Prices for Agent 'X'</h3>
<div class="skill-price-editor">
  <label>dance</label>
  <input type="number" value="1.00">
  <span>USDC</span>
</div>
<div class="skill-price-editor">
  <label>tell_joke</label>
  <input type="number" placeholder="Not for sale">
  <span>USDC</span>
</div>
<button id="save-prices-btn">Save Prices</button>
```
