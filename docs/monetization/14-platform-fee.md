# Prompt 14: Platform Fee (Backend)

## Objective
Implement a platform fee on every skill purchase transaction, splitting the payment between the skill creator and the platform's treasury wallet.

## Explanation
Platform fees are a standard monetization strategy. This task involves modifying the transaction creation logic to calculate a fee (e.g., 5%) and adding a second transfer instruction to the transaction. This ensures that a portion of every sale is automatically sent to the platform.

## Instructions
1.  **Define Platform Wallet and Fee Rate:**
    *   In your backend configuration (e.g., environment variables), define your platform's Solana wallet address (`PLATFORM_WALLET_ADDRESS`) and the fee percentage (`PLATFORM_FEE_BPS`, in basis points, e.g., 500 for 5%).

2.  **Update the Payment Endpoint (`api/payments/prepare-skill-purchase.js`):**
    *   Inside the handler, after fetching the skill price:
        *   Calculate the platform fee from the total amount. Be careful with integer division and rounding; it's best to work with `BigInt` for token amounts to avoid precision errors.
        *   Calculate the amount the creator will receive (total amount - platform fee).
        *   Create two `createTransferInstruction` calls:
            1.  One instruction to transfer the creator's portion to their payout wallet.
            2.  A second instruction to transfer the platform fee to the platform's wallet.
        *   Add both transfer instructions to the same `Transaction` object.

3.  **Atomicity:**
    *   Because both transfers are part of the same transaction, the operation is atomic. If any part of it fails, the entire transaction (both the payment to the creator and the fee to the platform) will fail, ensuring consistency.

## Code Example (Backend - `api/payments/prepare-skill-purchase.js`)

```javascript
// ... (imports)

const PLATFORM_WALLET = new PublicKey(process.env.PLATFORM_WALLET_ADDRESS);
// Fee in basis points (100 bps = 1%)
const PLATFORM_FEE_BPS = BigInt(process.env.PLATFORM_FEE_BPS || 500); 

export default async function handler(req, res) {
    // ... (handler setup)
    try {
        // ... (get buyer, creator wallet, price info)

        const transaction = new Transaction({ /* ... */ });
        const buyerUsdcAddress = await getAssociatedTokenAddress(USDC_MINT, buyerPublicKey);
        const creatorUsdcAddress = await getAssociatedTokenAddress(USDC_MINT, creatorPublicKey);
        const platformUsdcAddress = await getAssociatedTokenAddress(USDC_MINT, PLATFORM_WALLET);

        const totalAmount = BigInt(priceInfo.amount);

        // Calculate fees using BigInt for precision
        const platformFee = (totalAmount * PLATFORM_FEE_BPS) / 10000n;
        const creatorAmount = totalAmount - platformFee;
        
        // Instruction 1: Transfer to creator
        transaction.add(
            createTransferInstruction(
                buyerUsdcAddress,
                creatorUsdcAddress,
                buyerPublicKey,
                creatorAmount // Use BigInt amount
            )
        );

        // Instruction 2: Transfer platform fee
        if (platformFee > 0) {
            transaction.add(
                createTransferInstruction(
                    buyerUsdcAddress,
                    platformUsdcAddress,
                    buyerPublicKey,
                    platformFee // Use BigInt amount
                )
            );
        }

        // ... (serialize and return transaction)

    } catch (error) {
        // ... (error handling)
    }
}
```
