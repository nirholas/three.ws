---
status: not-started
---

# Prompt 12: Platform Fee Implementation

## Objective
Implement a platform fee on every skill purchase transaction.

## Explanation
To ensure the sustainability of the platform, a small percentage of each sale will be collected as a platform fee. This needs to be calculated and transferred during the payment process.

## Instructions
1.  **Modify the Payment Transaction:**
    *   In `src/marketplace.js`, when constructing the purchase transaction, add a second instruction.
    *   The first instruction will transfer the creator's share of the payment to their wallet.
    *   The second instruction will transfer the platform's fee to the platform's treasury wallet.

2.  **Configuration:**
    *   The platform fee percentage should be configurable and stored in a secure location.

## Code Example (Frontend - `src/marketplace.js`)

```javascript
// Inside the purchase logic
const platformFee = price.amount * 0.05; // 5% fee
const creatorGets = price.amount - platformFee;

const transaction = new solanaWeb3.Transaction()
    .add(
        solanaWeb3.SystemProgram.transfer({
            fromPubkey: user.publicKey,
            toPubkey: new solanaWeb3.PublicKey(creatorWalletAddress),
            lamports: creatorGets,
        })
    )
    .add(
        solanaWeb3.SystemProgram.transfer({
            fromPubkey: user.publicKey,
            toPubkey: new solanaWeb3.PublicKey(platformTreasuryAddress),
            lamports: platformFee,
        })
    );
```
