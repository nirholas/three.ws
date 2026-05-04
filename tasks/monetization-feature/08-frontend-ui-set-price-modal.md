---
status: not-started
---
# Prompt 8: Set Price Modal UI

**Status:** Not Started

## Objective
Design and implement a modal dialog on the Creator Dashboard for setting a skill's price.

## Explanation
Clicking the "Set Price" button next to a skill should open a modal where the creator can input a price and select a currency. This provides a clean and focused user experience for price management.

## Instructions
1.  **Add a hidden modal structure to `public/creator-dashboard.html`.** It should be outside the main flow, ready to be displayed with JavaScript.
2.  **The modal should contain:**
    - A title, e.g., "Set Price for [Skill Name]".
    - An input field for the `amount`.
    - A dropdown (`<select>`) for the `currency_mint`. Pre-fill this with supported currencies (e.g., USDC, SOL).
    - "Save" and "Cancel" buttons.
3.  **In `src/creator-dashboard.js`, add an event listener to the `#my-skills-list` container.**
4.  **Delegate the event to handle clicks on `.set-price-btn` buttons.**
5.  **When a button is clicked:**
    - Get the `skill_id` from the `data-skill-id` attribute.
    - Populate the modal's title with the skill's name.
    - Show the modal.

## HTML Example (in `creator-dashboard.html`)
```html
<div id="price-modal" class="modal" hidden>
    <div class="modal-content">
        <h2 id="modal-title">Set Price</h2>
        <form id="price-form">
            <input type="hidden" id="modal-skill-id" />
            <div>
                <label for="price-amount">Amount</label>
                <input type="number" id="price-amount" step="0.01" min="0" required />
            </div>
            <div>
                <label for="price-currency">Currency</label>
                <select id="price-currency" required>
                    <option value="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6T">USDC</option>
                    <!-- Add other currencies like native SOL -->
                </select>
            </div>
            <button type="submit">Save</button>
            <button type="button" id="modal-cancel-btn">Cancel</button>
        </form>
    </div>
</div>
```
