---
status: not-started
---

# Prompt 13: Support for SPL Token Payments

## Objective
Extend the payment system to support payments with SPL tokens, such as USDC.

## Explanation
Many users prefer to transact with stablecoins like USDC. Supporting SPL tokens will make the platform more accessible and user-friendly.

## Instructions
1.  **Modify the Frontend Transaction:**
    *   In `src/marketplace.js`, the transaction logic needs to be updated.
    *   Instead of `SystemProgram.transfer`, you will use the `Token.createTransferInstruction` from the `@solana/spl-token` library.
    *   This requires knowing the user's and the creator's token accounts for the specific SPL token.

2.  **Associated Token Accounts:**
    *   You will need to find the associated token accounts for the sender and receiver. If they don't exist, you might need to include instructions to create them in the transaction.

3.  **Backend Verification:**
    *   The backend payment verification logic must also be updated to correctly parse and validate SPL token transfers.
