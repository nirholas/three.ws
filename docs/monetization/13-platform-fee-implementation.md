# Prompt 13: Platform Fee Implementation

## Status
- [ ] Not Started

## Objective
Implement a platform fee on every skill purchase, where a percentage of the sale amount is sent to a platform-owned treasury wallet.

## Explanation
To ensure the platform is sustainable, a platform fee is essential. This requires modifying the transaction creation logic to split the payment between the seller and the platform.

## Instructions
1.  **Configure Treasury Wallet:**
    *   Store the platform's treasury wallet address in a secure configuration file or environment variable (e.g., `PLATFORM_TREASURY_WALLET`).

2.  **Modify Transaction Creation API:**
    *   In the `/api/payments/prepare-transaction` endpoint, calculate the platform fee based on the total price (e.g., a 5% fee).
    *   The total price is `priceInfo.amount`.
    *   `platformFee = priceInfo.amount * 0.05`
    *   `sellerAmount = priceInfo.amount - platformFee`

3.  **Create a Multi-Instruction Transaction:**
    *   The Solana transaction will now have two `createTransferInstruction` calls:
        1.  A transfer of `sellerAmount` from the buyer to the seller.
        2.  A transfer of `platformFee` from the buyer to the platform's treasury wallet.
    *   Add both instructions to the same transaction. This ensures the payment split is atomic—either both transfers succeed, or neither does.

## Code Example (Backend - `/api/payments/prepare-transaction.js` Update)
```javascript
// ... (imports and initial setup)

// Inside the handler function, after fetching priceInfo and sellerPublicKey
const PLATFORM_FEE_BPS = 500; // 500 basis points = 5%
const PLATFORM_TREASURY = new PublicKey(process.env.PLATFORM_TREASURY_WALLET);

const totalAmount = priceInfo.amount;
const platformFee = Math.floor(totalAmount * (PLATFORM_FEE_BPS / 10000));
const sellerAmount = totalAmount - platformFee;

// ... (setup connection, buyer, seller, mint)

const buyerTokenAccount = await getOrCreateAssociatedTokenAccount(connection, buyer, mint, buyer);
const sellerTokenAccount = await getOrCreateAssociatedTokenAccount(connection, buyer, mint, seller);
const treasuryTokenAccount = await getOrCreateAssociatedTokenAccount(connection, buyer, mint, PLATFORM_TREASURY);

// Create the transaction with TWO transfer instructions
const transaction = new Transaction();

// 1. Transfer to seller
transaction.add(
  createTransferInstruction(
    buyerTokenAccount.address,
    sellerTokenAccount.address,
    buyer,
    sellerAmount
  )
);

// 2. Transfer to platform treasury
transaction.add(
  createTransferInstruction(
    buyerTokenAccount.address,
    treasuryTokenAccount.address,
    buyer,
    platformFee
  )
);

// ... (set blockhash, feePayer, serialize and send)
```

## Important Considerations
*   **Rounding:** Be mindful of potential rounding errors when calculating fees. Using integer math with basis points (BPS) is generally safer.
*   **Associated Token Accounts:** Ensure the platform's treasury wallet has an associated token account for each currency you support. The `getOrCreateAssociatedTokenAccount` function helps with this, but the transaction to create it might need to be handled separately or signed by the platform.
