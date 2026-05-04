---
status: not-started
---

# Prompt 8: Backend Solana Pay Transaction Request

## Objective
Create a backend API endpoint that generates a Solana Pay transaction request for a specific skill purchase.

## Explanation
When a user clicks "Buy", the frontend needs to ask the backend to prepare a transaction. The backend will define the transaction parameters (recipient, amount, etc.) and encode them into a special URL format that Solana Pay wallets understand. This ensures that the payment details are secure and controlled by the platform.

## Instructions
1.  **Create the API Endpoint:**
    *   Create a new GET endpoint, for example, `/api/purchase/transaction`.
    *   This endpoint should accept query parameters for `agentId` and `skillName`.

2.  **Logic to Fetch Price:**
    *   Inside the endpoint, use the `agentId` and `skillName` to look up the price from the `agent_skill_prices` table in your database.
    *   If no price is found, return an error.

3.  **Define Transaction Parameters:**
    *   **Recipient:** This should be the agent owner's public key, which you should have stored alongside the agent's data. For now, you can use a placeholder wallet address.
    *   **Amount:** The price of the skill, fetched from the database.
    *   **SPL Token:** The currency mint address (e.g., USDC).
    *   **Reference:** A unique public key generated on the fly for this specific transaction. This is crucial for tracking the payment later. Use `Keypair.generate().publicKey`.
    *   **Label:** The name of your platform or store.
    *   **Message:** A descriptive message, e.g., "Purchase of 'SkillName' for 'AgentName'".
    *   **Memo:** A short, unique identifier for the purchase, which will be attached to the on-chain transaction. This helps with auditing. E.g., `agent-123:skill-abc`.

4.  **Construct Solana Pay URL:**
    *   The endpoint needs to return a URL that starts with `solana:`. The rest of the URL is the *URL of the endpoint itself*, which the wallet will then call to get the transaction details.
    *   Example: `solana:https://your-api.com/api/purchase/details?agentId=...&skillName=...`

5.  **Create the Transaction Details Endpoint:**
    *   Create a second endpoint (e.g., `POST /api/purchase/details`) that the wallet will call. This is part of the Solana Pay spec.
    *   This endpoint receives the user's public key in the request body (`{ account: "USER_WALLET_ADDRESS" }`).
    *   It should return a JSON object containing the full transaction details, including a base64-encoded, serialized transaction.
    *   Use the `@solana/web3.js` library to build a `SystemProgram.transfer` or `splToken.createTransferInstruction` transaction.
    *   Add the `memo` to the transaction.
    *   Serialize the transaction, but **do not sign it**. The user's wallet will sign.

## Code Example (Backend - Express.js style)

```javascript
// This is the first endpoint the frontend calls
// GET /api/purchase/transaction?agentId=...&skillName=...
app.get('/api/purchase/transaction', (req, res) => {
    const { agentId, skillName } = req.query;
    // IMPORTANT: The URL returned here is the *next* endpoint the wallet will call.
    const url = new URL(`${req.protocol}://${req.get('host')}/api/purchase/details`);
    url.searchParams.set('agentId', agentId);
    url.searchParams.set('skillName', skillName);

    // This is the URL the QR code will encode
    const solanaPayUrl = `solana:${encodeURIComponent(url.toString())}`;
    res.json({ url: solanaPayUrl });
});


// This is the second endpoint the WALLET calls
// POST /api/purchase/details
app.post('/api/purchase/details', async (req, res) => {
    const { account } = req.body; // User's wallet address
    const { agentId, skillName } = req.query;

    // 1. Fetch skill price and agent owner's wallet from DB
    const priceInfo = await db.getSkillPrice(agentId, skillName); // { amount, currency_mint, owner_wallet }
    if (!priceInfo) {
        return res.status(404).json({ error: "Skill or price not found" });
    }

    // 2. Create a reference keypair for tracking
    const reference = new solanaWeb3.Keypair().publicKey;

    // 3. Build the transaction
    const transaction = new solanaWeb3.Transaction();
    // ... logic to get recent blockhash ...

    // Add a transfer instruction
    transaction.add(
        splToken.createTransferInstruction(...) // From: `account`, To: `priceInfo.owner_wallet`, Amount: `priceInfo.amount`
    );

    // Add the memo
    transaction.add(new solanaWeb3.TransactionInstruction({
        keys: [],
        programId: new solanaWeb3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcVnuizgaCgWvunP'),
        data: Buffer.from(`Purchase: ${skillName} from Agent ${agentId}`),
    }));

    transaction.feePayer = new solanaWeb3.PublicKey(account);
    transaction.recentBlockhash = ...;

    // 4. Serialize and encode
    const serializedTx = transaction.serialize({ requireAllSignatures: false });
    const base64Tx = serializedTx.toString('base64');

    // 5. Return the response in Solana Pay format
    res.json({
        transaction: base64Tx,
        message: `Purchase ${skillName}`,
    });
});
```
