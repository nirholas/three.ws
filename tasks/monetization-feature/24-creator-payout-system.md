---
status: not-started
---

# Prompt 24: Creator Payout System

**Status:** Not Started

## Objective
Develop a system for creators to withdraw their earnings from the platform to their own wallet.

## Explanation
While sales are directly to the creator's wallet in our current model, a future model where the platform holds funds in escrow before paying out would require a withdrawal system. This prompt outlines that future state.

## Instructions
- [ ] **This assumes a model where funds are not sent directly to the creator on purchase.** Instead, they are sent to a platform-controlled wallet, and the creator's earnings are tracked as a balance in our database.
- [ ] **Create a `creator_balances` table.**
    - `creator_id`, `currency_mint`, `balance`.
- [ ] **Update the creator earnings dashboard.**
    - Show the current withdrawable balance.
    - Add a "Withdraw" button.
- [ ] **Create a withdrawal API endpoint.**
    - When a creator requests a withdrawal:
        - 1. Verify they have sufficient balance.
        - 2. Construct a transfer transaction from the platform's hot wallet to the creator's registered wallet.
        - 3. Process the transfer and update the creator's balance in the database.
        - 4. Log the withdrawal in a `payouts` table for history.
- [ ] **Implement security measures:**
    - 2FA for withdrawals.
    - Time-locks or manual approval for large amounts.
