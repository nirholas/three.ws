---
status: not-started
---

# Prompt 21: Platform Fee Mechanism

## Objective
Implement a mechanism in the backend to automatically take a platform fee from every successful transaction (skill purchase or subscription payment).

## Explanation
A platform fee is a primary business model for a marketplace. This requires modifying the transaction-building logic to split the payment between the creator and the platform. On Solana, this is typically done using multiple transfer instructions within the same transaction.

## Instructions
1.  **Configuration:**
    *   Store the platform fee percentage and the platform's treasury wallet address in a secure configuration file or environment variables. Do not hardcode them.
    *   Example: `PLATFORM_FEE_BPS=500` (500 basis points = 5%) and `PLATFORM_TREASURY_WALLET="YOUR_WALLET_ADDRESS"`.

2.  **Modify Transaction-Building Logic:**
    *   Locate all the places where you create a Solana Pay transaction (`/api/purchase/details`, `/api/subscribe/details`, `/api/tip/details`).
    *   For each transaction, calculate the fee amount.
        *   `totalAmount` = price of the item.
        *   `feeAmount` = `totalAmount * (PLATFORM_FEE_BPS / 10000)`.
        *   `creatorAmount` = `totalAmount - feeAmount`.
    *   Ensure you are working with integers (lamports) to avoid floating-point errors.

3.  **Add a Second Transfer Instruction:**
    *   Instead of a single transfer instruction from the user to the creator, the transaction will now have two:
        *   **Instruction 1:** Transfer `creatorAmount` from the user's wallet to the creator's wallet.
        *   **Instruction 2:** Transfer `feeAmount` from the user's wallet to the platform's treasury wallet (`PLATFORM_TREASURY_WALLET`).
    *   Add both of these instructions to the same `Transaction` object.

4.  **Atomic Transactions:**
    *   The beauty of this approach is that the transaction is atomic. If either transfer fails, the entire transaction fails. The user pays once, and the funds are split and distributed in a single, on-chain event.

5.  **Update Verification Logic:**
    *   Your transaction verification logic must now be updated to look for and validate *both* transfer instructions. It needs to confirm that the creator received the correct amount and the platform received its fee.

## Code Example (Backend - Modified Details Endpoint)

```javascript
// Inside a Solana Pay details endpoint (e.g., POST /api/purchase/details)
app.post('/api/purchase/details', async (req, res) => {
    // ... fetch priceInfo { amount, currency_mint, owner_wallet } ...
    const totalAmount = priceInfo.amount;

    // 1. Calculate split
    const PLATFORM_FEE_BPS = 500; // 5%
    const PLATFORM_TREASURY_WALLET = new solanaWeb3.PublicKey('...');
    const feeAmount = Math.floor(totalAmount * (PLATFORM_FEE_BPS / 10000));
    const creatorAmount = totalAmount - feeAmount;

    // ... build transaction, get blockhash ...
    const transaction = new solanaWeb3.Transaction();

    // 2. Add two transfer instructions
    // Transfer to creator
    transaction.add(
        splToken.createTransferInstruction(
            userTokenAccount, // From: user's token account
            creatorTokenAccount, // To: creator's token account
            userPublicKey, // User is the owner/signer
            creatorAmount
        )
    );
    // Transfer to platform treasury
    transaction.add(
        splToken.createTransferInstruction(
            userTokenAccount, // From: user's token account
            platformTokenAccount, // To: platform's token account
            userPublicKey, // User is the owner/signer
            feeAmount
        )
    );

    // ... add memo, set fee payer, serialize and return ...
});
```

**Note:** This requires you to know the correct SPL Token accounts for the user, creator, and platform. You may need to use `splToken.getAssociatedTokenAddress()` to find or create them as part of the transaction logic. This can get complex, especially if an account doesn't exist yet. An alternative for SOL transfers is to use `SystemProgram.transfer`.
