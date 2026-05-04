---
status: not-started
---

# Prompt 5: UI - Skill Purchase Flow

**Status:** Not Started

## Objective
Integrate the frontend of the agent detail page with the skill purchase API to allow users to buy skills.

## Explanation
Now that the backend can generate a purchase transaction, we need to add a "Buy" button for paid skills in the UI. When a user clicks this button, it should initiate the purchase flow using the Solana Pay API.

## Instructions
- [ ] **Modify the `renderDetail` function in `src/marketplace.js`** (or equivalent file).
- [ ] **For paid skills, instead of just showing a price badge, render a "Buy" button.**
- [ ] **Add an event listener to the "Buy" button.** On click, it should:
    - 1. **Get the user's wallet address.** Use the connected wallet's public key.
    - 2. **Make a `POST` request** to the `/api/skills/purchase` endpoint created in the previous prompt.
    - 3. **Receive the Solana Pay transaction** from the API.
    - 4. **Use the wallet adapter** to ask the user to sign and send the transaction.
    - 5. **Handle the transaction states:**
        - Display a "processing" indicator.
        - On confirmation, show a success message and update the UI to show the skill as "owned".
        - On failure, show an error message.

## Tracking Owned Skills
You'll need a way to know which skills the user already owns. A new table, `user_owned_skills`, might be necessary, or you can check on-chain for past transactions. For now, a simple client-side state update after purchase is sufficient.
