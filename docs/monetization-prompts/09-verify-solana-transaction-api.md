# Prompt 09: Backend Transaction Verification API

## Objective
Create the backend API endpoint that securely verifies a Solana transaction signature after it has been confirmed on the blockchain.

## Explanation
This is a critical security step. The frontend informs the backend that a transaction is complete by sending its signature. The backend must then independently fetch the transaction from the blockchain and verify that its contents (amount, sender, receiver) are correct before granting the user access to the skill. This prevents users from sending fake signatures or signatures for unrelated transactions.

## Instructions
1.  **Create the API File and Route:**
    *   Create a new API file, e.g., `api/skills/purchase/verify.js`.
    *   It will handle `POST` requests with `transactionSignature`, `agentId`, and `skillName` in the body.

2.  **Fetch the Transaction from the Blockchain:**
    *   Use the `@solana/web3.js` SDK's `connection.getParsedTransaction()` method with the provided signature. This method is useful as it parses the instruction data.

3.  **Perform Verification Checks:**
    *   Check if the transaction was successful (`err` field is null).
    *   Look up the expected price and creator wallet from your database for the given `agentId` and `skillName`.
    *   Parse the transaction's instructions to find the token transfer.
    *   **Crucially, verify:**
        *   The transfer `source` matches the buyer's public key (you might need to get this from the user's session or the transaction itself).
        *   The transfer `destination` matches the creator's expected payout wallet.
        *   The transfer `amount` matches the expected price from your database.
        *   The token `mint` matches the expected currency (e.g., USDC).

4.  **Handle Verification Outcome:**
    *   If all checks pass, proceed to the next step: recording the ownership in the database.
    *   If any check fails, return a `400 Bad Request` or `403 Forbidden` error with a message like "Transaction verification failed."

## Code Example (Node.js with Express-like framework)

```javascript
import { Connection, PublicKey } from '@solana/web3.js';

export default async function handler(req, res) {
    const { transactionSignature, agentId, skillName } = req.body;
    
    // 1. Get expected data from DB (pseudo-code)
    const expectedPrice = await db.getSkillPrice(agentId, skillName);
    const creator = await db.getAgentCreator(agentId);
    // Assume we get buyer public key from authenticated session
    const expectedBuyer = new PublicKey(req.session.user.publicKey); 

    const connection = new Connection(clusterApiUrl('devnet'));
    
    // 2. Fetch transaction
    const tx = await connection.getParsedTransaction(transactionSignature, 'confirmed');
    if (!tx || tx.meta.err) {
        return res.status(400).json({ message: "Transaction not found or failed." });
    }

    // 3. Find the transfer instruction and verify details
    const transferInstruction = tx.transaction.message.instructions.find(ix => ix.parsed?.type === 'transferChecked');
    
    if (!transferInstruction) {
        return res.status(400).json({ message: "No valid transfer instruction found." });
    }

    const { source, destination, tokenAmount } = transferInstruction.parsed.info;
    const isVerified = source === expectedBuyer.toBase58() &&
                       destination === creator.payout_wallet &&
                       parseInt(tokenAmount.amount) === expectedPrice.amount;

    // 4. Handle outcome
    if (isVerified) {
        // Ownership recording logic comes next
        await recordSkillOwnership(req.session.user.id, agentId, skillName);
        res.status(200).json({ message: "Verification successful." });
    } else {
        res.status(403).json({ message: "Transaction details do not match expected values." });
    }
}
```
