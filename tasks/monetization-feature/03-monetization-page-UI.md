---
status: completed
---

# Prompt 3: Monetization Page UI

## Objective
Create the user interface for the monetization page, allowing creators to set prices for their agent's skills.

## Explanation
With the backend ready, we now need a UI that allows agent creators to manage the prices of their skills. This will be a new "Monetization" tab in the agent editor (`agent-edit.html`). The UI will fetch the agent's skills and their current prices, display them in a form, and allow the creator to save changes.

## Instructions
- [ ] **Add a "Monetization" Tab:**
    - [ ] In `agent-edit.html`, add a new tab to the tab list named "Monetization".
    - [ ] Create a corresponding panel for the monetization content.

- [ ] **Build the Pricing Form:**
    - [ ] In the new panel, create a form that lists all of the agent's skills.
    - [ ] For each skill, display a text input field to enter the price in USDC.
    - [ ] Fetch the current prices from the API endpoint you created earlier (`/api/agents/:id/skills-pricing`) and populate the form.
    - [ ] Add a "Save Prices" button.

- [ ] **Implement Save Functionality:**
    - [ ] When the "Save Prices" button is clicked, collect the data from the form.
    - [ ] For each skill, create a price object `{ skill, amount, currency_mint, chain }`. Remember to convert the USDC amount back to the smallest unit (e.g., multiply by 1,000,000).
    - [ ] Send this data to the backend via a `PUT` request to `/api/agents/:id/skills-pricing`.
    - [ ] Display a success or error message to the user.

- [ ] **Handle Loading and Error States:**
    - [ ] Show a loading indicator while fetching prices.
    - [ ] Display a clear error message if the API call fails.
