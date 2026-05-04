---
status: not-started
completed_at: null
---
# Prompt 6: On-Chain Payment API with Solana Pay

## Objective
Create a backend API endpoint that generates a Solana Pay transaction request for purchasing a specific agent skill.

## Explanation
To accept payments for skills, we need to integrate with the Solana blockchain. This prompt outlines the creation of an API endpoint that follows the Solana Pay specification. When a user wants to buy a skill, the frontend will call this endpoint. The endpoint will generate the details for a valid SPL Token transfer transaction, which the user's wallet will then use to approve the payment.

## Instructions
1.  **Define the API Endpoint:**
    *   Create a new route: `GET /api/purchase/skill/:agentId/:skillName`. This will be the main endpoint for initiating a purchase.
    *   Also, create a `POST` handler for the same route, which will be used by the Solana Pay protocol to validate the transaction after the user signs it.

2.  **Implement the `GET` Handler (Transaction Request):**
    *   **Fetch Skill Price:** From the database, retrieve the `amount` and `currency_mint` for the requested `agentId` and `skillName`. If not found, return a `404 Not Found`.
    *   **Fetch Creator's Wallet:** Get the agent creator's destination wallet address. This should be stored securely with the creator's user profile.
    *   **Generate a Unique Reference Key:** Create a new, unique keypair (`Keypair.generate()`). The public key of this keypair will serve as a unique reference for the transaction, preventing double-spending. Store this reference in your database or cache temporarily, associating it with the purchase details (user, skill, agent).
    *   **Construct the Solana Pay Response:**
        *   `label`: The name of your platform.
        *   `icon`: A URL to your platform's logo.
        *   For the `POST` handler, construct the JSON response which includes the details needed for the wallet to build the transaction:
            *   `transaction`: A Base64-encoded, serialized, but **unsigned** transaction.
            *   `message` (optional): A descriptive message, e.g., "Purchase 'translate' skill for Agent 'X'".
        *   The transaction should be a simple SPL Token transfer from the buyer (the wallet will fill this in) to the creator's wallet address.
        *   The transaction must include the unique `reference` public key.

3.  **Implement the `POST` Handler (Transaction Validation):**
    *   **Receive Transaction:** The wallet will send the user-signed transaction to this endpoint. The body will contain `{ transaction: "..." }`.
    *   **Deserialize and Verify:**
        *   Deserialize the transaction.
        *   Check that the signature is valid for the expected signer (the user).
        *   Verify that the transaction details match the expected purchase: correct recipient, correct amount, correct SPL token mint, and the **correct unique reference key**. This is crucial for security.
    *   **Record the Purchase:** If verification passes, save the purchase details to your `user_skill_purchases` table, including the transaction signature.
    *   **Return Confirmation:** Respond with a success message including the transaction signature.

## Code Example (Backend `GET` Handler)

```javascript
// Example using Express.js and @solana/web3.js, @solana/spl-token

// GET /api/purchase/skill/:agentId/:skillName
app.get('/api/purchase/skill/:agentId/:skillName', async (req, res) => {
  // ... fetch skillPrice, creatorWallet from db ...

  const { amount, currency_mint } = skillPrice;
  const recipient = new PublicKey(creatorWallet);
  const splToken = new PublicKey(currency_mint);

  // Generate a unique reference for this transaction
  const reference = new Keypair().publicKey;
  // Store reference in cache/db to validate it in the POST request
  await cache.set(`ref_${reference.toBase58()}`, { agentId, skillName, userId: req.user.id });

  res.status(200).json({
    label: "My 3D Agent Platform",
    icon: "https://my-platform.com/logo.png",
  });
});

// POST /api/purchase/skill/:agentId/:skillName
app.post('/api/purchase/skill/:agentId/:skillName', async (req, res) => {
    // This endpoint should return the actual transaction details
    const { account } = req.body;
    if (!account) {
        return res.status(400).json({ error: 'Account is required.' });
    }
    // ... fetch skillPrice, creatorWallet from db ...
    // ... generate reference, etc ...
    
    // Create the unsigned transaction
    const transaction = new Transaction();
    // ... add SPL token transfer instruction ...
    // The instruction needs: source (user's wallet), destination (creator's wallet), amount, mint.
    // The wallet will provide the user's source token account.
    
    res.status(200).json({
        transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
        message: `Purchase skill for ${(amount / 1e6).toFixed(2)} USDC`,
    });
});
```

## Definition of Done
-   A `GET` endpoint exists at `/api/purchase/skill/:agentId/:skillName` that returns the `label` and `icon` for a Solana Pay request.
-   A `POST` endpoint exists at the same URL that takes a public key `account` and returns a serialized, unsigned transaction.
-   The transaction is a valid SPL token transfer for the correct amount and token.
-   A unique reference key is generated for each transaction request.
-   The `POST` handler for validating the final signed transaction is implemented and secure.
-   Successful purchases are recorded in the `user_skill_purchases` table.
