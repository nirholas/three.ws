# Prompt 08: Backend Purchase API Endpoint

## Objective
Create the initial backend API endpoint that constructs and returns a Solana transaction for a skill purchase.

## Explanation
The frontend needs a secure way to get a valid transaction object. The backend is responsible for creating this transaction because it has secure access to critical information like the creator's payout wallet and the correct skill price, preventing tampering.

## Instructions
1.  **Create the API File and Route:**
    *   Create a new API file, e.g., `api/transactions/create-skill-purchase.js`.
    *   This file will handle `POST` requests. It should expect `agentId`, `skillName`, and `buyerPublicKey` in the request body.

2.  **Fetch Necessary Data:**
    *   Inside the endpoint logic, perform database lookups to get:
        *   The skill's price from the `agent_skill_prices` table.
        *   The agent creator's payout wallet address from the `users` or `agents` table.
        *   The platform's fee wallet address (can be a constant or from a config file).

3.  **Construct the Solana Transaction:**
    *   Use the `@solana/web3.js` SDK.
    *   You will be creating a SPL Token Transfer instruction. The currency is likely USDC, so you'll need its mint address.
    *   The transaction will transfer `X` amount of USDC from the `buyerPublicKey` to the creator's wallet. (Platform fees will be added in a later prompt).
    *   Set the `feePayer` to be the `buyerPublicKey`.
    *   Fetch a recent blockhash.

4.  **Serialize and Return the Transaction:**
    *   Serialize the transaction but **do not sign it**. The user's wallet must sign it.
    *   Return the serialized transaction as a base64-encoded string in the JSON response.

## Code Example (Node.js with Express-like framework)

```javascript
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, createTransferInstruction } from '@solana/spl-token';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const { agentId, skillName, buyerPublicKey } = req.body;

    // 1. Fetch data from DB (pseudo-code)
    const priceInfo = await db.getSkillPrice(agentId, skillName); // { amount: 1000000, currency_mint: '...' }
    const creator = await db.getAgentCreator(agentId); // { payout_wallet: '...' }

    const connection = new Connection(clusterApiUrl('devnet'));
    const buyer = new PublicKey(buyerPublicKey);
    const creatorWallet = new PublicKey(creator.payout_wallet);
    const usdcMint = new PublicKey(priceInfo.currency_mint);

    // 2. Get the buyer's and creator's token accounts
    const buyerUsdcAccount = await getOrCreateAssociatedTokenAccount(connection, buyer, usdcMint, buyer);
    const creatorUsdcAccount = await getOrCreateAssociatedTokenAccount(connection, buyer, usdcMint, creatorWallet);
    
    // 3. Create the transaction
    const transaction = new Transaction().add(
        createTransferInstruction(
            buyerUsdcAccount.address,
            creatorUsdcAccount.address,
            buyer,
            priceInfo.amount // Amount in smallest unit (lamports for SOL, etc.)
        )
    );

    transaction.feePayer = buyer;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    // 4. Serialize and return
    const serializedTx = transaction.serialize({ requireAllSignatures: false });
    
    res.status(200).json({
        transaction: serializedTx.toString('base64'),
    });
}
```
