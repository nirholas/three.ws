# Prompt 18: Refactor to a Payment SDK

## Objective
Abstract the core Solana payment logic into a reusable SDK within the `agent-payments-sdk/` directory to promote code reuse and maintainability.

## Explanation
As the platform grows, you may want to add payments for other items, such as purchasing agents, tipping creators, or buying 3D assets. Repeating the Solana Pay transaction logic in each API endpoint would be inefficient and error-prone. By creating a centralized `PaymentSDK`, we can handle all payment-related operations in one place.

## Instructions
1.  **Identify Core Logic:**
    *   Review your `api/payments/prepare-skill-purchase.js` endpoint.
    *   Identify the reusable parts:
        *   Creating and configuring a `Connection`.
        *   Constructing SPL token transfer instructions.
        *   Handling platform fees.
        *   Serializing and structuring the transaction for the Solana Pay response.
        *   Verifying a transaction signature.

2.  **Create the SDK Module (`agent-payments-sdk/src/index.ts`):**
    *   Create a `PaymentSDK` class or a set of exported functions.
    *   Move the core logic identified above into methods within this SDK.
    *   For example, you could have a method `createSplTransferTransaction(buyer, transfers, reference)` where `transfers` is an array of `{ destination, amount }` objects. This method would handle the platform fee calculation internally.
    *   Another method could be `verifyTransaction(signature, expectedTransfers)`.

3.  **Refactor the API Endpoint:**
    *   Rewrite the `prepare-skill-purchase.js` endpoint to use your new SDK.
    *   The endpoint will now be much simpler. It will be responsible for fetching the business logic details (like the skill price and creator wallet) and then calling the SDK methods to construct and verify the transaction.

## Code Example (`agent-payments-sdk/src/index.ts`)

```typescript
import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';

interface Transfer {
    destination: PublicKey;
    amount: bigint; // Use BigInt for lamports
}

export class PaymentSDK {
    private connection: Connection;
    private platformWallet: PublicKey;
    private platformFeeBps: bigint;

    constructor(rpcUrl: string, platformWallet: string, feeBps: number) {
        this.connection = new Connection(rpcUrl);
        this.platformWallet = new PublicKey(platformWallet);
        this.platformFeeBps = BigInt(feeBps);
    }

    async createPurchaseTransaction(
        buyer: PublicKey,
        creator: PublicKey,
        totalAmount: bigint,
        mint: PublicKey,
        reference: PublicKey
    ): Promise<Transaction> {
        const { blockhash } = await this.connection.getLatestBlockhash();
        const transaction = new Transaction({ recentBlockhash: blockhash, feePayer: buyer });

        const buyerAta = await getAssociatedTokenAddress(mint, buyer);
        const creatorAta = await getAssociatedTokenAddress(mint, creator);
        const platformAta = await getAssociatedTokenAddress(mint, this.platformWallet);

        const platformFee = (totalAmount * this.platformFeeBps) / 10000n;
        const creatorAmount = totalAmount - platformFee;

        transaction.add(
            createTransferInstruction(buyerAta, creatorAta, buyer, creatorAmount),
        );
        if (platformFee > 0) {
            transaction.add(
                createTransferInstruction(buyerAta, platformAta, buyer, platformFee),
            );
        }
        
        // Add reference for lookup
        transaction.add(SystemProgram.transfer({ fromPubkey: buyer, toPubkey: reference, lamports: 0 }));

        return transaction;
    }
    // ... other methods like verifyTransaction
}
```
