---
status: not-started
---

# Prompt 12: Creator Payout Wallet Setup

## Objective
Allow agent creators to specify and save a Solana wallet address for receiving payments.

## Explanation
To pay creators, we need to know where to send the funds. This involves adding a field to the database for their payout address and creating a UI and API for them to manage this setting.

## Instructions
- [ ] **Update Database Schema:**
    - [ ] Add a new column to your `users` table (or whichever table represents your creators).
    - [ ] The column should be named `payout_wallet_address` or similar.
    - [ ] It should be a `VARCHAR` or `TEXT` field, capable of storing a Solana public key (e.g., up to 44 characters). It can be nullable, as a user might not be a creator.

- [ ] **Create API Endpoint for Saving Wallet Address:**
    - [ ] Create a new API endpoint, e.g., `PUT /api/users/payout-settings`.
    - [ ] This endpoint should be protected by authentication middleware.
    - [ ] It will accept a new `payout_wallet_address` in the request body.
    - [ ] Validate that the provided string is a valid Solana public key.
    - [ ] Update the `payout_wallet_address` for the authenticated user in the database.

- [ ] **Update "Create Transaction" Endpoint:**
    - [ ] Modify the `POST /api/transactions/create-skill-purchase` endpoint.
    - [ ] When fetching creator details, retrieve the new `payout_wallet_address`.
    - [ ] Use this address as the destination for the payment transfer in the Solana transaction. If the address is not set, the transaction should fail with an error indicating the creator has not configured their payouts.

## SQL Schema Example (Alter Table)

```sql
ALTER TABLE users
ADD COLUMN payout_wallet_address VARCHAR(44) NULL;
```

## API Validation Example (Node.js)

```javascript
import { PublicKey } from '@solana/web3.js';

function isValidSolanaAddress(address) {
    try {
        new PublicKey(address);
        return true;
    } catch (e) {
        return false;
    }
}

// In your PUT /api/users/payout-settings endpoint
const { payout_wallet_address } = req.body;
if (!isValidSolanaAddress(payout_wallet_address)) {
    return res.status(400).json({ message: "Invalid Solana wallet address." });
}

// ... proceed to update database for req.user.id
```
