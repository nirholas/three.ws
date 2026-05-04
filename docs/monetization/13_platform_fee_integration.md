---
status: not-started
last_updated: 2026-05-04
---
# Prompt 13: Platform Fee Integration

## Objective
Modify the skill purchase transaction to include a platform fee that is sent to the company's treasury wallet.

## Explanation
To create a sustainable business model, the platform will take a small percentage of each skill sale. This needs to be handled on-chain and transparently. The backend will now construct a transaction with two transfers instead of one: one for the creator's payout and one for the platform fee.

## Instructions
1.  **Update Configuration:**
    *   Store the platform's treasury wallet address and the fee percentage in a secure configuration file or environment variables (e.g., `PLATFORM_FEE_BPS=500` for 5%, `PLATFORM_TREASURY_WALLET="...address..."`).

2.  **Modify the Purchase Preparation API:**
    *   Locate the `POST /api/skills/purchase-prep` endpoint.
    *   Inside the transaction construction logic, calculate the platform fee from the total skill price. For example, if the fee is 5% (500 basis points), `fee_amount = total_price * 500 / 10000`.
    *   The creator's payout is now `creator_amount = total_price - fee_amount`.
    *   **Add a second `spl-token` transfer instruction** to the transaction.
        *   The first instruction transfers `creator_amount` to the creator's wallet.
        *   The second instruction transfers `fee_amount` to the platform's treasury wallet.
    *   The user still signs a single transaction, but it now atomically handles both the payout and the platform fee.

3.  **Update Purchase Confirmation:**
    *   The `POST /api/skills/purchase-confirm` endpoint should be updated to verify this new transaction structure. It now needs to look for *two* `spl-token` transfers and validate that both the creator payout and the platform fee were sent correctly.

## Code Example (Inside `purchase-prep` API)

```javascript
// ... after fetching price and wallets
const PLATFORM_FEE_BPS = 500; // 5%
const PLATFORM_TREASURY_WALLET = new PublicKey("...");
const totalAmount = skillPrice.amount;

const feeAmount = Math.floor(totalAmount * PLATFORM_FEE_BPS / 10000);
const creatorAmount = totalAmount - feeAmount;

// ...
const tx = new Transaction({ /* ... */ });

// Instruction for Creator Payout
tx.add(
    createTransferInstruction(
        buyerAta.address,
        creatorAta.address,
        buyerPublicKey,
        creatorAmount
    )
);

// Instruction for Platform Fee
const platformTreasuryAta = await getOrCreateAssociatedTokenAccount(
    connection,
    buyerPublicKey,
    usdcMint,
    PLATFORM_TREASURY_WALLET
);
tx.add(
    createTransferInstruction(
        buyerAta.address,
        platformTreasuryAta.address,
        buyerPublicKey,
        feeAmount
    )
);

// ... serialize and return the transaction with two instructions
```
