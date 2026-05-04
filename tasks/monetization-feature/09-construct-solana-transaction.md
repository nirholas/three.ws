# Prompt 9: Construct Solana Transaction

## Objective
On the frontend, write a function that constructs a Solana transaction to transfer the required amount of USDC from the user's wallet to the agent creator's wallet.

## Explanation
A Solana transaction is a set of instructions that the user must sign. For a simple SPL-token payment (like USDC), the main instruction is a `Token.createTransferInstruction`. This instruction needs several pieces of information:
- The user's (source) USDC token account address.
- The creator's (destination) USDC token account address.
- The user's main wallet address (the owner of the source account).
- The amount to transfer.
- The SPL Token Program ID.

Our task is to gather this information and build the transaction object, which we'll then pass to the wallet for signing in the next step. A key challenge is finding the user's and creator's *USDC-specific token accounts*, not just their main wallet addresses.

## Instructions
1.  **Create a Transaction Builder Function:**
    *   In `src/marketplace.js`, create a new `async` function called `buildUsdcTransferTransaction`.
    *   It should accept the `intent` object (which contains the recipient's main wallet address, amount, and currency mint) and the `payerPublicKey` (the connected user's wallet public key).

2.  **Find Associated Token Accounts (ATAs):**
    *   The standard way to hold tokens on Solana is in "Associated Token Accounts." We can derive the address of these accounts if we have the main wallet address and the token mint address.
    *   Use the `solanaWeb3.PublicKey.findProgramAddress` or a helper from `@solana/spl-token` to find the payer's and recipient's USDC ATAs. The `spl-token` library provides `getAssociatedTokenAddress`.

3.  **Handle Missing Recipient ATA:**
    *   The recipient might not have a USDC account yet. A robust solution creates the account for them within the same transaction. The `spl-token` library has an instruction for this: `createAssociatedTokenAccountInstruction`. Check if the recipient's ATA exists, and if not, add this instruction to the transaction.

4.  **Create the Transfer Instruction:**
    *   Use the `spl-token` library's `createTransferInstruction` to build the core payment instruction.
    *   You'll need the source ATA, destination ATA, payer's public key (as the owner), and the amount from the intent.

5.  **Assemble the Transaction:**
    *   Create a new `solanaWeb3.Transaction`.
    *   Add the `createAssociatedTokenAccountInstruction` if it was needed.
    *   Add the `createTransferInstruction`.
    *   Set the `feePayer` to the `payerPublicKey`.
    *   Fetch a recent blockhash from the `solanaConnection` and assign it to the transaction's `recentBlockhash`.
    *   Return the fully constructed transaction object.

## Code Example (Frontend - `src/marketplace.js`)

**Note:** This is complex and requires the SPL Token library. Assume you have it available via a script tag.
`<script src="https://unpkg.com/@solana/spl-token@0.3.7/lib/index.iife.js"></script>`

```javascript
// Add this helper function to marketplace.js
const { TOKEN_PROGRAM_ID } = splToken;

async function buildUsdcTransferTransaction(intent, payerPublicKey) {
    const { recipient_address, amount, currency_mint } = intent;

    const transaction = new solanaWeb3.Transaction();

    const mintPublicKey = new solanaWeb3.PublicKey(currency_mint);
    const recipientPublicKey = new solanaWeb3.PublicKey(recipient_address);

    // 1. Get or create the recipient's associated token account
    const recipientAta = await splToken.getAssociatedTokenAddress(
        mintPublicKey,
        recipientPublicKey
    );
    const recipientAtaInfo = await solanaConnection.getAccountInfo(recipientAta);
    if (!recipientAtaInfo) {
        transaction.add(
            splToken.createAssociatedTokenAccountInstruction(
                payerPublicKey,
                recipientAta,
                recipientPublicKey,
                mintPublicKey
            )
        );
    }

    // 2. Get the payer's associated token account
    const payerAta = await splToken.getAssociatedTokenAddress(
        mintPublicKey,
        payerPublicKey
    );

    // 3. Create the transfer instruction
    transaction.add(
        splToken.createTransferInstruction(
            payerAta,
            recipientAta,
            payerPublicKey,
            parseInt(amount)
        )
    );

    // 4. Set the fee payer and recent blockhash
    transaction.feePayer = payerPublicKey;
    const { blockhash } = await solanaConnection.getRecentBlockhash();
    transaction.recentBlockhash = blockhash;

    return transaction;
}
```
