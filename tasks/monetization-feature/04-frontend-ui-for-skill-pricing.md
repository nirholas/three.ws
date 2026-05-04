---
status: not-started
---

# Prompt 4: UI for Skill Pricing

**Status:** Not Started

## Objective
Build the user interface in the agent editor for creators to set and manage prices for their skills.

## Explanation
Now that the backend can handle skill pricing, we need to provide a user interface for creators. This UI will be part of the agent editing page. It should list all of the agent's skills and provide input fields for creators to set a price for each one. The UI should be intuitive, allowing for easy adding, updating, and removing of prices.

## Instructions
- **Locate the Agent Editor UI:**
    - The main file for the agent editor is likely `agent-edit.html`.
    - The corresponding JavaScript that handles the logic is likely in `src/agent-edit.js` or similar.

- **Design the Pricing Section:**
    - Within the agent editor, find the area where skills are listed or managed.
    - For each skill, add a section for pricing. This should include:
        - An input field for the price amount.
        - A dropdown or input to select the currency (e.g., "USDC").
        - A "Save" button to save the price.
        - A "Remove" button to clear the price.
    - The UI should clearly distinguish between free and priced skills.

- **Implement the UI Logic:**
    - When the agent data is loaded, populate the pricing inputs with existing values from the `agent.skill_prices` object.
    - When the "Save" button is clicked, call the `POST /api/agents/[id]/skill-prices` endpoint you created in the previous prompt.
    - When the "Remove" button is clicked, call the `DELETE /api/agents/[id]/skill-prices` endpoint.
    - Provide feedback to the user on success or failure (e.g., a "Saved!" message or an error alert).

## Code Example (Frontend - `agent-edit.html` structure)

This is a conceptual example of the HTML structure. You will need to integrate this into your existing templating or DOM-building logic.

```html
<!-- Inside the agent editor's skills list -->
<div class="skill-item">
    <span class="skill-name">greet</span>
    <div class="skill-pricing-form">
        <input type="number" class="skill-price-input" placeholder="e.g., 1.50" value="1.50">
        <select class="skill-currency-select">
            <option value="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6f">USDC</option>
        </select>
        <button class="btn-save-price">Save</button>
        <button class="btn-remove-price">Remove</button>
    </div>
</div>
```

## CSS Example

Add styles to `/agent-edit.css` to make the form look clean.

```css
.skill-pricing-form {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.skill-price-input {
  width: 80px;
}
```
