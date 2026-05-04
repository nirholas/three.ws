# Prompt 7: Integrate Solana Wallet Adapter

## Objective
Integrate the Solana Wallet Adapter into the marketplace page to enable users to connect their Solana wallets (like Phantom, Solflare, etc.).

## Explanation
To accept payments on the Solana blockchain, our web application needs to communicate with the user's wallet. The Solana Wallet Adapter is a suite of libraries that provides a standardized way to connect to various wallets, get the user's public key, and request transaction signatures. This is the foundation for our payment flow.

## Instructions
1.  **Add Script Tags:**
    *   Open `marketplace.html`.
    *   In the `<head>` section, add script tags to import the necessary Wallet Adapter libraries from a CDN (like unpkg). You will need `wallet-adapter-base`, `wallet-adapter-solana`, and `wallet-adapter-wallets`. You should also include the CSS for the adapter's UI components.

2.  **Initialize the Wallet Adapter:**
    *   In `src/marketplace.js`, create a new function to initialize the wallet adapter.
    *   Instantiate the wallets you want to support (e.g., `PhantomWalletAdapter`, `SolflareWalletAdapter`).
    *   Create a `Connection` object pointing to the Solana cluster you're using (e.g., 'mainnet-beta' or 'devnet').
    *   Use these to create the main wallet adapter instance.

3.  **Render the Wallet Button:**
    *   The wallet adapter library provides a pre-built UI component for a "Connect Wallet" button.
    *   In your initialization code, create an instance of this button and append it to the `payment-wallet-area` in your payment modal.

4.  **Listen for Connection Changes:**
    *   The adapter emits events when a user connects or disconnects.
    *   Add event listeners to update the UI accordingly. For instance, when a user connects, you can show their public key and change the button to "Disconnect." You should also enable the "Confirm Purchase" button.

## Code Example (`marketplace.html`)

Add these scripts and the link tag to the `<head>` of your `marketplace.html`.

```html
<!-- In <head> of marketplace.html -->
<link rel="stylesheet" href="https://unpkg.com/@solana/wallet-adapter-react-ui/styles.css" />

<script src="https://unpkg.com/@solana/web3.js@latest/lib/index.iife.js"></script>
<script src="https://unpkg.com/@solana/wallet-adapter-base@latest/lib/index.iife.js"></script>
<script src="https://unpkg.com/@solana/wallet-adapter-wallets@latest/lib/index.iife.js"></script>
<script src="https://unpkg.com/@solana/wallet-adapter-react@latest/lib/index.iife.js"></script>
<script src="https://unpkg.com/@solana/wallet-adapter-react-ui@latest/lib/index.iife.js"></script>
```

## Code Example (`src/marketplace.js`)

```javascript
// Add these variables and functions to the top level of marketplace.js

const { Connection, clusterApiUrl } = solanaWeb3;
const { WalletAdapterBase } = solanaWalletAdapterBase;
const { getPhantomWallet, getSolflareWallet } = solanaWalletAdapterWallets;
const { WalletModalProvider, WalletMultiButton } = solanaWalletAdapterReactUi;

let solanaConnection;
let wallet; // This will hold our wallet adapter instance

function initWalletAdapter() {
    solanaConnection = new Connection(clusterApiUrl('mainnet-beta'));
    
    const wallets = [
        getPhantomWallet(),
        getSolflareWallet(),
    ];

    // The library is React-based, but we can use it imperatively.
    // This is a simplified, non-React setup.
    // A proper implementation would require a bit more work to integrate with a non-React app.
    
    // For now, let's create a simpler, custom connection flow in the next prompt.
    // The official components are difficult to use without React.
    
    console.log('Solana Wallet Adapter concept initialized.');
}

// In your main init() function, call initWalletAdapter();
```

**Correction & Simplification:** The official Solana Wallet Adapter UI libraries are heavily based on React, making them cumbersome to use in a vanilla JS project. The next prompt will focus on a simplified, custom implementation for connecting the wallet and signing the transaction, using the base adapter libraries without the UI components. This prompt serves to get the necessary scripts included in the project.
