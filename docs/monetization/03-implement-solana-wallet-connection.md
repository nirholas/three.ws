# Prompt 3: Implement Solana Wallet Connection

## Status
- [ ] Not Started

## Objective
Implement the core logic for connecting to a user's Solana wallet using a standard wallet adapter library like `@solana/wallet-adapter-base` and `@solana/wallet-adapter-wallets`.

## Explanation
This prompt builds on the previous one by implementing the functionality behind the "Connect Wallet" button. We will use the Solana Wallet Adapter libraries to present the user with a list of installed wallets (e.g., Phantom, Solflare) and manage the connection state.

## Instructions
1.  **Install Dependencies:**
    *   Add the necessary Solana wallet adapter libraries to your project's `package.json` and install them.
    *   You'll typically need `@solana/web3.js`, `@solana/wallet-adapter-base`, `@solana/wallet-adapter-wallets`, and specific wallet adapters you wish to support.

2.  **Update the Wallet Module (`src/wallet.js`):**
    *   Import the wallet adapter classes.
    *   Instantiate the wallets you want to support (e.g., `PhantomWalletAdapter`, `SolflareWalletAdapter`).
    *   Implement the `onConnectWallet` function to trigger the wallet adapter's connect flow. This will typically open a modal for the user to select their wallet.
    *   Listen for changes in the wallet's connection status and update the UI accordingly using the `updateWalletState` function created previously.

## Code Example (Terminal - Installation)
```bash
npm install @solana/web3.js @solana/wallet-adapter-base @solana/wallet-adapter-wallets @solana/wallet-adapter-phantom
```

## Code Example (src/wallet.js)
```javascript
// src/wallet.js
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { Connection, PublicKey } from '@solana/web3.js';

let connectedWalletAddress = null;

// Initialize the wallet adapter
const wallet = new PhantomWalletAdapter();

// Listen for connection events
wallet.on('connect', (publicKey) => {
  connectedWalletAddress = publicKey.toBase58();
  console.log(`Wallet connected: ${connectedWalletAddress}`);
  updateWalletState(connectedWalletAddress);
});

wallet.on('disconnect', () => {
  console.log('Wallet disconnected');
  connectedWalletAddress = null;
  updateWalletState(null);
});

async function onConnectWallet() {
  if (!wallet.connected) {
    try {
      await wallet.connect();
    } catch (error) {
      console.error('Wallet connection failed:', error);
    }
  }
}

export function updateWalletState(address) {
  const btn = document.getElementById('connect-wallet-btn');
  if (address) {
    btn.textContent = `${address.slice(0, 4)}...${address.slice(-4)}`;
  } else {
    btn.textContent = 'Connect Wallet';
  }
}

export function initWalletButton() {
  const btn = document.getElementById('connect-wallet-btn');
  if (btn) {
    btn.addEventListener('click', onConnectWallet);
  }
  // Auto-connect if wallet is already connected
  if (wallet.autoConnect) {
     wallet.autoConnect();
  }
}

export function getConnectedWallet() {
    return wallet.connected ? wallet : null;
}

export function getConnectedWalletAddress() {
    return connectedWalletAddress;
}
```
