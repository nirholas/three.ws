---
status: not-started
---

# Prompt 3: UI - Creator Dashboard for Pricing

**Status:** Not Started

## Objective
Create a new section in the agent creator dashboard that allows creators to set and manage prices for their skills.

## Explanation
With the backend ready to store prices, we need a user interface for creators to manage them. This involves adding a new section to the agent edit page where each skill is listed with an input field to set its price.

## Instructions
- [ ] **Locate the agent edit page's code** (likely in `agent-edit.html` and its corresponding JavaScript file).
- [ ] **Fetch the agent's skills and any existing prices.**
- [ ] **For each skill, display its name and an input form.** The form should contain:
    - An input field for the `amount`.
    - A dropdown to select the `currency` (e.g., USDC, SOL). This should be pre-populated with supported currencies.
- [ ] **Implement a "Save Prices" button.** When clicked, this should:
    - Gather the pricing data for all skills.
    - Make an API call to a new endpoint (`/api/agents/:id/skill-prices`) to save the data.
    - Handle both creating new prices and updating existing ones.
- [ ] **Provide feedback to the user,** such as a confirmation message on successful save or an error message on failure.

## API Endpoint (`POST /api/agents/:id/skill-prices`)
You'll need to create this new endpoint. It should:
- Be authenticated to ensure only the agent's owner can set prices.
- Accept a payload like: `{ "prices": { "text-to-speech": { "amount": 500000, "currency_mint": "EP..." } } }`
- Upsert the prices into the `agent_skill_prices` table.
