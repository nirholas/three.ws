# Prompt 19: Platform Fee Integration

## Objective
Implement a platform fee on all transactions (both individual skill sales and subscription payments).

## Explanation
To create a sustainable business model, the platform needs to take a small percentage of each transaction. This requires modifying the on-chain payment logic to split the payment between the agent creator and the platform's treasury wallet.

## Instructions
1.  **Store Platform Wallet Address:**
    *   Store the platform's main treasury wallet address in a secure place, like an environment variable (`PLATFORM_TREASURY_WALLET`).

2.  **Modify Transaction Logic:**
    *   Locate the backend code that constructs the payment transaction (from Prompt 5 and Prompt 17).
    *   Instead of a single `SystemProgram.transfer` instruction, the transaction must now include **two** transfer instructions.

3.  **Calculate and Split Payment:**
    *   Define the platform fee percentage (e.g., 5%).
    *   When a payment is made, calculate the fee amount and the creator's share.
        *   `platform_fee = total_price * 0.05`
        *   `creator_share = total_price * 0.95`
    *   The first transfer instruction will send `creator_share` to the `creator_wallet_address`.
    *   The second transfer instruction will send `platform_fee` to the `PLATFORM_TREASURY_WALLET`.

4.  **Update Database and UI:**
    *   Ensure your `sales` table has columns to record the `platform_fee` and `creator_payout` amounts for transparent accounting.
    *   The UI should clearly state that the price includes a platform fee.

## Code Example (Updated Solana Transaction)
```javascript
// ...inside the purchase logic
const PLATFORM_FEE_PERCENT = 0.05; // 5%
const platformTreasury = new PublicKey(process.env.PLATFORM_TREASURY_WALLET);
const creatorWallet = new PublicKey(agent.creator_wallet_address);
const totalLamports = price.amount;

const platformFeeLamports = Math.round(totalLamports * PLATFORM_FEE_PERCENT);
const creatorShareLamports = totalLamports - platformFeeLamports;

const transaction = new Transaction()
    .add(
        // First instruction: pay the creator
        SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: creatorWallet,
            lamports: creatorShareLamports,
        })
    )
    .add(
        // Second instruction: pay the platform
        SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: platformTreasury,
            lamports: platformFeeLamports,
        })
    );
    
// Send and confirm the transaction as before...
```
