# Prompt 4: Wallet Integration for Payments

## Objective
Integrate a Solana wallet adapter to allow users to connect their crypto wallets to the platform, a prerequisite for making payments.

## Explanation
To interact with the Solana blockchain for payments, users must first connect their own wallet (like Phantom, Solflare, etc.). We will use the official Solana Wallet Adapter libraries to provide a standardized, user-friendly way for users to connect.

## Instructions
1.  **Add Dependencies:**
    *   Install the necessary Solana Wallet Adapter packages (`@solana/wallet-adapter-base`, `@solana/wallet-adapter-react`, `@solana/wallet-adapter-wallets`, etc., and their peer dependencies like `@solana/web3.js`).
    *   This might require refactoring parts of the frontend into a framework like React if not already done, or using the adapter with vanilla JS. For this prompt, assume a vanilla JS setup is possible.

2.  **Initialize Wallet Adapter:**
    *   In a core JavaScript file (e.g., `src/app.js` or `src/wallet.js`), import and initialize the wallet adapter providers.
    *   Create a "Connect Wallet" button in the main UI (e.g., the header).

3.  **Implement Connect/Disconnect Logic:**
    *   When the "Connect Wallet" button is clicked, present the user with a list of available wallets.
    *   Once a wallet is selected and approved by the user, the application should store the connection state and public key.
    *   The UI should update to show the user's connected wallet address and change the button to "Disconnect."

## Code Example (JavaScript - `src/wallet.js`)
```javascript
// This is a simplified example. Refer to official @solana/wallet-adapter docs for a full implementation.
import { Connection, PublicKey } from '@solana/web3.js';
import { WalletAdapter, PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';

// Setup
const connection = new Connection('https://api.mainnet-beta.solana.com');
const wallets = [new PhantomWalletAdapter()];

let wallet;

// UI Connection
document.getElementById('connect-wallet-btn').addEventListener('click', async () => {
    const selectedWallet = await showWalletChoice(); // UI function to let user pick from `wallets`
    wallet = selectedWallet;
    await wallet.connect();
    console.log('Wallet connected:', wallet.publicKey.toBase58());
    updateUIForConnectedState(wallet.publicKey);
});

wallet.on('connect', (publicKey) => {
    console.log('Connected to ' + publicKey.toBase58());
});
```
This is a complex task. The prompt provides the user with the high-level steps and concepts, guiding them through the official documentation.
