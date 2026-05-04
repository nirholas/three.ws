---
status: not-started
---

# Prompt 6: Backend - Payment Transaction API

## Objective
Create a backend API endpoint that generates a Solana transaction for a specific skill purchase and returns it to the frontend for signing.

## Explanation
To securely handle payments, the backend must be responsible for creating the transaction. The frontend will request a transaction for a specific skill, and this API will construct it, including the correct recipient address (the creator), the currency (e.g., USDC), and the amount. Returning the unsigned transaction to the frontend allows the user to sign it with their wallet without ever exposing their private key to our server.

## Instructions
1.  **Create the API Endpoint:**
    *   Create a new API file, e.g., `api/payments/create-transaction.js`.
    *   This endpoint will accept `POST` requests at `/api/payments/create-transaction`.

2.  **Request Body and Validation:**
    *   The request body from the frontend must include:
        *   `agentId`: The ID of the agent whose skill is being purchased.
        *   `skillName`: The name of the skill.
        *   `buyerPublicKey`: The public key of the user who is buying the skill.
    *   Validate this input.

3.  **Fetch Skill and Creator Data:**
    *   From your database, fetch the price (`amount`, `currency_mint`) for the given `skillName` and `agentId` from the `agent_skill_prices` table.
    *   Fetch the agent creator's payout wallet address from the `creator_payout_wallets` table (or `agent_identities` if stored there). Let's call this `creatorPublicKey`.

4.  **Construct the Solana Transaction:**
    *   Use the `@solana/web3.js` library.
    *   You will create a **Token Transfer** instruction using the `@solana/spl-token` library.
    *   The instruction needs:
        *   The buyer's associated token account for the currency (`source`).
        *   The creator's associated token account for the currency (`destination`).
        *   The buyer's main wallet address as the authority (`owner`).
        *   The `amount` from the database.
        *   The `currency_mint` from the database.
    *   **Important:** You may need to create the creator's associated token account if it doesn't exist. Your transaction might need to include the `createAssociatedTokenAccountInstruction`.
    *   Create a new `Transaction` and add the transfer instruction(s) to it.
    *   Set the `feePayer` to the `buyerPublicKey`.
    *   Set a `recentBlockhash`. You can get this from your Solana `Connection` object.

5.  **Serialize and Return:**
    *   Serialize the transaction *without signing it*.
    *   Return the serialized transaction to the frontend, base64-encoded.

## Code Example (`api/payments/create-transaction.js`)

```javascript
import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, createTransferInstruction } from '@solana/spl-token';
import { json, wrap } from '../_lib/http.js';
import { sql } from '../_lib/db.js';
// ... other imports

const SOLANA_RPC_ENDPOINT = process.env.SOLANA_RPC_ENDPOINT;
const connection = new Connection(SOLANA_RPC_ENDPOINT);

export default wrap(async (req, res) => {
    // ... authentication and input validation ...
    const { agentId, skillName, buyerPublicKey } = req.body;
    const buyer = new PublicKey(buyerPublicKey);

    // 1. Fetch price and creator wallet from DB
    const [priceInfo] = await sql`...`; // Get amount and currency_mint
    const [creatorInfo] = await sql`...`; // Get creator's payout wallet
    if (!priceInfo || !creatorInfo) {
        return json(res, 404, { error: 'Skill or creator wallet not found' });
    }

    const creator = new PublicKey(creatorInfo.wallet_address);
    const currencyMint = new PublicKey(priceInfo.currency_mint);
    const amount = BigInt(priceInfo.amount);

    // 2. Get the buyer's and creator's token accounts
    const buyerTokenAccount = await getOrCreateAssociatedTokenAccount(connection, buyer, currencyMint, buyer);
    const creatorTokenAccount = await getOrCreateAssociatedTokenAccount(connection, buyer, currencyMint, creator);

    // 3. Create the transaction
    const transaction = new Transaction();
    transaction.add(
        createTransferInstruction(
            buyerTokenAccount.address,    // from
            creatorTokenAccount.address,  // to
            buyer,                        // owner
            amount
        )
    );
    
    transaction.feePayer = buyer;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    // 4. Serialize and encode
    const serializedTransaction = transaction.serialize({ requireAllSignatures: false });
    const base64Transaction = serializedTransaction.toString('base64');

    return json(res, 200, { transaction: base64Transaction });
});
```
