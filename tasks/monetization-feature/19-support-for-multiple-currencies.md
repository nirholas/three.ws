---
status: not-started
---

# Prompt 19: Support for Multiple Currencies

**Status:** Not Started

## Objective
Allow creators to set prices in different SPL tokens (e.g., BONK, WIF) and allow buyers to pay in any of them.

## Explanation
To embrace the Solana ecosystem, we should support more than just USDC. This will involve using a DEX like Jupiter to handle currency swaps during the purchase.

## Instructions
- [ ] **Update the Creator Dashboard UI:** The currency dropdown for setting prices should include a list of whitelisted SPL tokens.
- [ ] **Update the Purchase API (`/api/skills/purchase`):**
    - The API should now accept an additional parameter: `payment_mint`, the token the user wants to pay with.
- [ ] **Integrate with Jupiter API:**
    - When a user wants to pay with BONK for a skill priced in USDC:
        - 1. Use the Jupiter API to get a `swap` transaction that converts the right amount of the user's BONK into the required amount of USDC.
        - 2. The destination for the USDC should be a temporary account or directly to the creator/platform wallets.
        - 3. **Combine the transactions:** The full transaction sent to the user will include the Jupiter swap *and* the payment transfers. The user signs one transaction that does everything.
- [ ] **Update the Frontend:** The "Buy" button should present the user with a choice of which token to pay with.
