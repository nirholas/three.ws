---
status: not-started
---

# Prompt 9: Platform Fee System

**Status:** Not Started

## Objective
Implement a platform fee for every skill purchase.

## Explanation
To make the platform sustainable, we will take a small percentage of each skill sale as a platform fee. This requires modifying the purchase transaction to include a transfer to the platform's wallet.

## Instructions
- [ ] **Modify the skill purchase API (`/api/skills/purchase`)**.
- [ ] **When constructing the transaction, add a second `transfer` instruction.**
    - The source will be the user's account.
    - The destination will be the platform's fee wallet.
    - The amount should be a percentage of the total price (e.g., 5%).
- [ ] **Adjust the creator's transfer amount.** The amount transferred to the creator should be the total price minus the platform fee.
- [ ] **The sum of the two transfers must equal the total amount** the user is paying.
- [ ] **Store the platform fee** in the `skill_sales` table for accounting purposes. Add a `platform_fee` column.

## Example
If a skill costs 1 USDC and the platform fee is 5%:
- The user pays 1 USDC.
- The creator receives 0.95 USDC.
- The platform receives 0.05 USDC.
The Solana transaction will contain two separate transfers to reflect this split. This is known as a "split transaction".
