# Prompt 20: Batch Skill Purchase (Shopping Cart)

## Objective
Allow users to add multiple skills to a "cart" and purchase them all in a single transaction.

## Explanation
Purchasing skills one by one can be tedious and costly in terms of transaction fees. A shopping cart feature improves the user experience by allowing a single, consolidated purchase for multiple items.

## Instructions
1.  **Frontend: Cart UI:**
    *   Instead of a "Purchase" button, have an "Add to Cart" button.
    *   Add a cart icon to the site header that shows the number of items.
    *   Clicking the icon opens a cart modal/sidebar, listing the selected skills and the total price.
    *   The cart should have a "Checkout" button.

2.  **Frontend: Cart State Management:**
    *   Use `localStorage` or a simple in-memory object to manage the cart's state (the list of skills to be purchased).
    *   When "Add to Cart" is clicked, add the skill's details (`agentId`, `skillName`) to the cart.
    *   When "Checkout" is clicked, pass the list of items in the cart to the backend.

3.  **Backend: Update "Create Transaction" Endpoint:**
    *   Modify `POST /api/transactions/create-skill-purchase` to accept an **array** of skills instead of a single skill.
    *   The endpoint will now loop through the array of skills.
    *   For each skill, it calculates the payment due to the respective creator.
    *   It will add a separate `SPL Token Transfer` instruction **for each skill** to the transaction. If a user buys 3 skills from 3 different creators, the transaction will contain 3 transfers (plus 3 platform fee transfers).
    *   The backend returns a single transaction that bundles all these transfers.

4.  **Backend: Update "Verify Transaction" Endpoint:**
    *   The verification logic must also be updated to handle multiple items.
    *   It will receive an array of skills that were supposed to be in the transaction.
    *   It must parse the transaction from the blockchain and verify that **all** the expected transfers (to creators and platform) are present and correct.
    *   If verification is successful, it should add a row to the `unlocked_skills` table for **each** purchased skill. This should be done in a database transaction.

## API Request Body Example (for Create Transaction)

```json
{
  "buyerPublicKey": "USER_WALLET_ADDRESS",
  "items": [
    { "agentId": 123, "skillName": "AdvancedAnalysis" },
    { "agentId": 456, "skillName": "ImageGeneration" }
  ]
}
```
