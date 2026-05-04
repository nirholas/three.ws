---
status: not-started
---

# Prompt 6: UI Payment Modal

## Objective
Design and implement a payment confirmation modal that appears when a user clicks the "Purchase Skill" button.

## Explanation
A modal is an excellent way to provide a focused and clear payment experience. This modal will display the details of the skill being purchased, the price, and a final confirmation button to initiate the transaction.

## Instructions
1.  **Create the Modal HTML:**
    *   In `marketplace.html`, add the HTML structure for a modal. It should be hidden by default.
    *   The modal should have a header, body, and footer.
    *   The body should contain placeholders for the skill name, price, and other details.
    *   The footer should have "Cancel" and "Confirm Purchase" buttons.

2.  **Implement JavaScript Logic:**
    *   In `src/marketplace.js`, add an event listener for clicks on the "Purchase" buttons.
    *   When a button is clicked, populate the modal with the correct skill information and display it.
    *   The "Confirm Purchase" button will trigger the blockchain transaction.

## Code Example (HTML - `marketplace.html`)

```html
<div id="payment-modal" class="modal-overlay hidden">
    <div class="modal">
        <div class="modal-header">
            <h3>Confirm Purchase</h3>
            <button id="close-payment-modal">&times;</button>
        </div>
        <div class="modal-body">
            <p>You are about to purchase the skill:</p>
            <h4 id="modal-skill-name"></h4>
            <p>Price: <strong id="modal-skill-price"></strong></p>
        </div>
        <div class="modal-footer">
            <button id="cancel-purchase" class="btn">Cancel</button>
            <button id="confirm-purchase" class="btn btn-primary">Confirm</button>
        </div>
    </div>
</div>
```
