# Prompt 08: Creator UI to Set Skill Prices

## Objective
Implement a user interface in the agent editor or creator dashboard that allows creators to add, edit, and remove prices for their agent's skills.

## Explanation
Now that the backend API for price management exists, we need to provide a user-friendly frontend for creators to use it. This will involve adding a new section to the agent editing page (`agent-edit.html`) where a list of the agent's skills is displayed, each with an input field to set its price.

## Instructions
1.  **Locate the Agent Editor Page:**
    *   Open `agent-edit.html` and its corresponding JavaScript file, likely `src/agent-edit.js`.

2.  **Add a "Skill Monetization" Section:**
    *   In `agent-edit.html`, add a new section or card titled "Skill Prices".
    *   This section should fetch and display the list of skills from the agent's manifest.

3.  **Implement the UI for Each Skill:**
    *   For each skill listed, display:
        *   The skill name.
        *   An input field for the price (e.g., in USDC).
        *   A "Set Price" or "Save" button.
        *   A "Remove Price" button if a price is already set.

4.  **Wire Up the API Calls:**
    *   In `src/agent-edit.js`, add event listeners to the "Save" and "Remove" buttons.
    *   **On Save:**
        *   Read the price from the input.
        *   Convert it to the smallest unit (e.g., multiply by 1,000,000 for USDC).
        *   Call the `POST` or `PUT` endpoint from Prompt 03 (`/api/agents/[id]/skill-prices`) with the `skill_id`, `amount`, and `currency_mint`.
    *   **On Remove:**
        *   Call the `DELETE` endpoint from Prompt 03.
    *   Provide user feedback (e.g., a success message or an error toast).

## HTML Example (`agent-edit.html`)

```html
<!-- Inside the agent editor form -->
<div class="card">
    <h3>Skill Prices</h3>
    <div id="skill-prices-list">
        <!-- Skills will be rendered here by JavaScript -->
        <!-- Example of a single skill item -->
        <div class="skill-price-item">
            <span>weather-forecast</span>
            <input type="number" step="0.01" placeholder="USDC Price">
            <button class="btn-primary">Set Price</button>
        </div>
    </div>
</div>
```
