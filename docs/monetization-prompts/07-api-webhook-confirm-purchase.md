# Prompt 07: API Webhook to Confirm Solana Pay Transactions

## Objective
Create a webhook to receive confirmation of successful Solana Pay transactions, find the corresponding purchase record, and update its status.

## Explanation
The Solana Pay workflow includes a server-to-server confirmation. After a user approves a transaction, the Solana Pay service (or a custom RPC listener) will post the transaction signature to a webhook we provide. This webhook is the definitive confirmation of payment. It needs to verify the transaction on-chain and update our database accordingly.

## Instructions
1.  **Create the Webhook API File:**
    *   Create a new file: `api/webhooks/solana-pay.js`.

2.  **Implement the Webhook Handler:**
    *   **`find` Method:** Solana Pay first sends a `GET` request to verify the endpoint exists. The handler should return a label and icon for the payment sheet.
    *   **`transaction` Method (`POST`):**
        *   The `POST` request contains the `transaction` (signature) and `reference` (our `purchaseId`).
        *   **Verify Transaction:** Use a Solana RPC connection (`@solana/web3.js`) to fetch the transaction details using the signature.
        *   **Validate Details:**
            *   Check that the transaction was successful.
            *   Confirm that the destination address, mint address, and amount match the details stored in our `user_skill_purchases` and `agent_skill_prices` tables. This is crucial to prevent spoofed transactions.
        *   **Update Purchase Status:** If validation passes, update the `user_skill_purchases` record's `status` to `'confirmed'` and store the `transaction_id`.
        *   Return a success message to the Solana Pay service.

## Code Example (`api/webhooks/solana-pay.js`)

```javascript
import { Connection, PublicKey } from '@solana/web3.js';
import { sql } from '../_lib/db.js';
import { error, json, wrap } from '../_lib/http.js';

const SOLANA_RPC_URL = process.env.RPC_URL_1399901; // Example for Solana Mainnet
const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

export default wrap(async (req, res) => {
  if (req.method === 'GET') {
    // Solana Pay endpoint validation
    return json(res, {
      label: '3D-Agent Skill Marketplace',
      icon: 'https://three.ws/assets/logo.png',
    });
  }

  if (req.method === 'POST') {
    const { transaction, reference } = await req.json();

    // 1. Find the purchase record using the reference
    const [purchase] = await sql`SELECT ... FROM user_skill_purchases WHERE id = ${reference}`;
    // ... join with prices to get expected amount, mint, recipient ...
    if (!purchase || purchase.status !== 'pending') {
      return error(res, 404, 'purchase_not_found_or_completed');
    }

    // 2. Verify the transaction on-chain
    const tx = await connection.getParsedTransaction(transaction, 'confirmed');
    // ... logic to parse tx and confirm amount, mint, and recipient ...
    
    const isValid =  /* ... validation logic ... */ ;

    if (isValid) {
      await sql`
        UPDATE user_skill_purchases
        SET status = 'confirmed', transaction_id = ${transaction}, updated_at = NOW()
        WHERE id = ${reference}
      `;
      return json(res, { message: 'Transaction confirmed' });
    } else {
      await sql`UPDATE ... SET status = 'failed' ...`;
      return error(res, 400, 'transaction_invalid');
    }
  }
});
```
