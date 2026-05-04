---
status: completed
---

# Prompt 5: Backend - Purchase Initiation API

**Status:** Not Started

## Objective
Create a backend API endpoint that prepares and returns the necessary information for a client to initiate a Solana Pay transaction.

## Explanation
To allow users to purchase a skill, the frontend needs to know the price, the recipient, and other transaction details. This endpoint will serve as the first step in the purchase flow. It will look up the skill's price and construct a Solana Pay-compliant response that the frontend can use to generate a QR code or automatically open a wallet.

## Instructions
- [ ] **Create the Endpoint:** Define a new endpoint, for example, `POST /api/purchase/skill`.
- [ ] **Request Body:** The endpoint should accept `agent_id` and `skill_name` in the request body.
- [ ] **Fetch Skill Price:**
    - Query the `agent_skill_prices` table for the price of the requested skill.
    - If the skill is free or the price is not found, return an appropriate error.
- [ ] **Fetch Creator's Wallet:**
    - Look up the agent's creator from the `agents` table.
    - Get the creator's public key (wallet address) from the `users` or a dedicated `wallets` table. This will be the recipient of the payment.
- [ ] **Construct Solana Pay Response:**
    - The response should be a JSON object containing:
        - `label`: The name of the store or app (e.g., "3D-Agent Marketplace").
        - `icon`: A URL to an icon for the transaction.
- [ ] **Integrate with Solana Pay SDK:**
    - Use the `@solana/pay` SDK on the backend.
    - Your endpoint should implement the `GET` portion of the Solana Pay spec. When a wallet pings this URL, it should return the recipient, amount, SPL token, etc.
    - You will also need a `POST` handler on this same endpoint. When the wallet confirms the transaction, it will `POST` the transaction signature here for verification.

## Code Example (Node.js/Express-style Solana Pay)

```javascript
// in api/purchase/skill.js

import { Keypair, Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { findReference, FindReferenceError } from '@solana/pay';
import { db } from '../_lib/db'; // Your database utility

// The GET handler is called by wallets to get transaction details
async function get(req, res) {
  const { agent_id, skill_name } = req.query;

  // 1. Fetch price and creator wallet from DB
  const priceInfo = await db.one(
    `SELECT p.amount, p.currency_mint, a.owner_id
     FROM agent_skill_prices p
     JOIN agents a ON p.agent_id = a.id
     WHERE p.agent_id = $1 AND p.skill_name = $2`,
    [agent_id, skill_name]
  );
  
  const creatorWallet = await db.one('SELECT wallet_address FROM users WHERE id = $1', [priceInfo.owner_id]);

  // 2. Respond with Solana Pay GET spec
  res.status(200).json({
    label: "3D-Agent Marketplace",
    icon: "https://your-app.com/icon.png",
  });
}

// The POST handler is called by wallets after the user approves the transaction
async function post(req, res) {
    const { account } = req.body;
    if (!account) throw new Error('Missing account');

    const { reference } = req.query;
    if (!reference) throw new Error('Missing reference');

    const signature = await verifyTransaction(account, reference);
    // Here you would grant the user access to the skill in your DB
    // grantSkillAccess(account, reference.skill_name);

    res.status(200).json({ status: 'ok', signature });
}


async function verifyTransaction(account, reference) {
    const connection = new Connection(clusterApiUrl('mainnet-beta'));
    
    // Find the transaction signature from the reference
    const signatureInfo = await findReference(connection, new PublicKey(reference));
    
    // Here you would add more validation, e.g., checking the transaction amount and destination match the skill price.

    return signatureInfo.signature;
}
```
