# Prompt 16: Implement Different Currencies (SOL, etc.)

**Status:** - [ ] Not Started

## Objective
Extend the skill monetization feature to support payments in different SPL tokens, starting with SOL (as Wrapped SOL).

## Explanation
Currently, the system is hardcoded for USDC. To provide more flexibility for creators and users, the platform should support a selection of popular SPL tokens for pricing and payment.

## Instructions
1.  **Update Database Schema:**
    *   The `agent_skill_prices` table already has a `currency_mint` column, which is great. Ensure your database queries and API responses handle this correctly.

2.  **Modify Creator UI for Pricing:**
    *   In the "Skill Monetization" section of `agent-edit.html`, change the currency selector from a static element to a dropdown menu.
    *   Populate this dropdown with a list of supported currencies (e.g., "USDC", "SOL", "BONK"). This list can be hardcoded for now.
    *   When a creator selects a currency, store the corresponding mint address along with the price.

3.  **Update Frontend Purchase Logic:**
    *   In `src/marketplace.js`, when constructing the purchase transaction, the mint address should not be hardcoded. It should be read from the `skillPrice.currency_mint` property.
    *   The UI in the purchase modal should also dynamically display the correct currency symbol and amount.
    *   **Special Handling for SOL:** Since SOL is the native token, payments in SOL are not standard SPL token transfers. The easiest way to handle this is to use Wrapped SOL (WSOL). The user's wallet will need to wrap SOL into WSOL before transferring. The `@solana/spl-token` library provides functions for this, and it can be done in the same transaction as the transfer.

## Code Example (Frontend - `spl-token-transfer.js` logic update)

```javascript
// Inside the purchase confirmation logic
import { NATIVE_MINT } from '@solana/spl-token'; // The mint address for WSOL

// ...
const currencyMint = new PublicKey(priceInfo.currency_mint);

const transaction = new Transaction();
let userTokenAccount = await getAssociatedTokenAddress(currencyMint, userPublicKey);

// Special handling if the currency is SOL (i.e., WSOL)
if (currencyMint.equals(NATIVE_MINT)) {
  const userWsolAccountInfo = await connection.getAccountInfo(userTokenAccount);
  
  // If the user doesn't have a WSOL account, or not enough WSOL,
  // we need to create one and/or wrap some SOL.
  if (!userWsolAccountInfo || userWsolAccountInfo.data.length === 0) {
    // Add instruction to create the associated token account for WSOL
  }
  
  // You might need to check the user's SOL balance and add an instruction
  // to wrap the required amount of SOL into WSOL.
  // This involves transferring SOL to the WSOL account and calling a sync instruction.
}

// The transfer instruction remains the same, but now works with any currency mint
transaction.add(
  createTransferInstruction(
    userTokenAccount,
    creatorTokenAccount,
    userPublicKey,
    priceInfo.amount
  )
);

// ... send and confirm transaction
```
*Note: Handling Wrapped SOL adds significant complexity. You need to manage account creation and wrapping SOL within the same transaction, which requires careful balance management and instruction ordering.*
