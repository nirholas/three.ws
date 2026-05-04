# Prompt 13: Platform Fee Logic

## Objective
Implement the logic to automatically take a platform fee from each skill purchase transaction.

## Explanation
A platform fee is a common monetization strategy. This involves splitting the payment from the buyer into two parts: one for the creator and one for the platform. This logic should be handled securely on the backend when the transaction is created.

## Instructions
1.  **Configure Platform Wallet:**
    *   Store the platform's fee-collecting wallet address in a secure configuration file or environment variable on your backend. Do not hardcode it in the API logic.

2.  **Define Platform Fee Rate:**
    *   Define the platform's fee percentage (e.g., `5%` or `0.05`) in the same configuration.

3.  **Update the "Create Transaction" Endpoint:**
    *   In your `POST /api/transactions/create-skill-purchase` endpoint:
    *   After fetching the skill price, calculate the fee amount (e.g., `feeAmount = price * platformFeeRate`).
    *   Calculate the creator's proceeds (`creatorAmount = price - feeAmount`). Ensure you are working with integers to avoid floating-point issues.
    *   Add a **second** SPL Token Transfer instruction to the Solana transaction.
        *   The first instruction will transfer `creatorAmount` from the buyer to the creator.
        *   The second instruction will transfer `feeAmount` from the buyer to the platform's wallet.
    *   The transaction will now contain two separate transfer instructions. The Solana runtime will execute them atomically.

4.  **Update the "Verify Transaction" Endpoint:**
    *   Your verification logic at `POST /api/skills/purchase/verify` must also be updated.
    *   It should now look for **two** transfer instructions in the fetched transaction.
    *   It must verify that both transfers are correct: the right amount to the right creator, and the right fee amount to the right platform wallet. Verification fails if either is incorrect.

## Code Example (Create Transaction Endpoint with Fee)

```javascript
// ... inside /api/transactions/create-skill-purchase

const PLATFORM_FEE_RATE = 0.05; // 5%
const PLATFORM_WALLET = new PublicKey(process.env.PLATFORM_WALLET_ADDRESS);

const price = priceInfo.amount;
const feeAmount = Math.round(price * PLATFORM_FEE_RATE);
const creatorAmount = price - feeAmount;

// ... get buyerUsdcAccount, creatorUsdcAccount, etc.
const platformUsdcAccount = await getOrCreateAssociatedTokenAccount(connection, buyer, usdcMint, PLATFORM_WALLET);

const transaction = new Transaction()
    .add(
        // Instruction 1: Payment to Creator
        createTransferInstruction(
            buyerUsdcAccount.address,
            creatorUsdcAccount.address,
            buyer,
            creatorAmount
        )
    )
    .add(
        // Instruction 2: Fee to Platform
        createTransferInstruction(
            buyerUsdcAccount.address,
            platformUsdcAccount.address,
            buyer,
            feeAmount
        )
    );

// ... set feePayer, blockhash, and serialize
```
