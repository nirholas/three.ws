---
status: not-started
---
# Prompt 18: Backend Revenue Sharing

**Status:** Not Started

## Objective
Implement a simple revenue sharing model in the backend where the platform takes a small percentage fee from each skill sale.

## Explanation
To create a sustainable business model, the platform needs to generate revenue. A common approach is to take a small commission on transactions occurring in the marketplace. This task modifies the transaction creation logic to include a platform fee.

## Instructions
1.  **Establish a platform wallet address.** Store this securely in your backend environment variables (e.g., `PLATFORM_WALLET_ADDRESS`).
2.  **Define the platform fee percentage.** Store this as a constant or environment variable (e.g., `PLATFORM_FEE_PERCENT = 0.05` for 5%).
3.  **Locate the API endpoint that initiates the purchase transaction (`/api/skills/:skill_id/purchase` from Prompt 5).**
4.  **Modify the transaction construction logic:**
    - Calculate the payment amount for the creator (`price * (1 - PLATFORM_FEE_PERCENT)`).
    - Calculate the platform fee amount (`price * PLATFORM_FEE_PERCENT`).
    - Instead of one `SystemProgram.transfer` instruction, the transaction will now have two:
        - One transfer from the user to the skill creator's wallet.
        - A second transfer from the user to the platform's wallet.
5.  **Return the new two-instruction transaction to the client for signing.**

## Code Example (Backend - `initiatePurchase` logic)
```javascript
// ... inside the initiatePurchase function
const priceInfo = ...
const creatorWallet = new PublicKey(creator.wallet_address);
const platformWallet = new PublicKey(process.env.PLATFORM_WALLET_ADDRESS);
const feePercentage = 0.05; // 5%

const creatorAmount = Math.floor(priceInfo.amount * (1 - feePercentage));
const feeAmount = priceInfo.amount - creatorAmount; // Avoid floating point issues

const transaction = new Transaction(...);

// Transfer to creator
transaction.add(SystemProgram.transfer({
    fromPubkey: user_wallet,
    toPubkey: creatorWallet,
    lamports: creatorAmount,
}));

// Transfer to platform
transaction.add(SystemProgram.transfer({
    fromPubkey: user_wallet,
    toPubkey: platformWallet,
    lamports: feeAmount,
}));

// Serialize and return transaction...
```
