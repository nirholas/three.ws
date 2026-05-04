# Prompt 23: Gifting Skills

## Objective
Implement a feature that allows a user to purchase a skill and have the ownership NFT sent to another user's wallet address.

## Explanation
Gifting is a powerful social and commercial feature. It allows users to introduce others to the platform and expands the potential market for creators' skills.

## Instructions
1.  **Add "Gift" Option to UI:**
    *   In the purchase modal (from Prompt 3), add a checkbox or button that says "This is a gift."
    *   When checked, reveal a new input field for the user to enter the recipient's Solana wallet address.

2.  **Modify Backend Minting Logic:**
    *   Update the `/api/skills/mint` endpoint (from Prompt 7).
    *   The endpoint should now optionally accept a `recipient_address` in the request body.
    *   If `recipient_address` is provided, the backend must use *that* address as the owner when minting the NFT.
    *   If it's not provided, it should default to the wallet address of the user making the purchase (the `user_wallet`).

3.  **Update Frontend Request:**
    *   In `src/marketplace.js`, when the purchase is confirmed, check if the gift option is enabled.
    *   If it is, validate the recipient address on the frontend, and then include it in the body of the `fetch` request to the `/api/skills/mint` endpoint.

4.  **Transaction Payer:**
    *   The transaction for the *payment* is still paid and signed by the person buying the gift. The only thing that changes is the *destination address* for the NFT being minted.

## Code Example (Frontend `marketplace.js`)
```javascript
// Inside the 'Confirm Purchase' click handler
const isGift = document.getElementById('gift-checkbox').checked;
let recipientAddress = null;

if (isGift) {
    const input = document.getElementById('recipient-address-input');
    // Validate the address
    try {
        new PublicKey(input.value);
        recipientAddress = input.value;
    } catch (e) {
        alert('Invalid recipient address');
        return;
    }
}

// ... after payment is confirmed, call the mint endpoint
const response = await fetch('/api/skills/mint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        // ... other params like agent_id, skill_name
        user_wallet: wallet.publicKey.toBase58(),
        recipient_address: recipientAddress // will be null if not a gift
    })
});
```
