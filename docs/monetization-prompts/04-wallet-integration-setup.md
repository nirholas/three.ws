# Prompt 04: Frontend Wallet Integration Setup

## Objective
Integrate a Solana wallet adapter to allow users to connect their wallets (e.g., Phantom) to the application.

## Explanation
To perform any on-chain transactions, the user must first connect their cryptocurrency wallet. This step involves adding the necessary libraries and UI elements for wallet connection. We will use the official Solana wallet-adapter libraries.

## Instructions
1.  **Add Wallet-Adapter Libraries:**
    *   Include the Solana wallet-adapter scripts in `marketplace.html`. You can use a CDN like unpkg for this proof-of-concept. You'll need `@solana/wallet-adapter-base` and `@solana/wallet-adapter-wallets`, plus the DOM integration package.

2.  **Add "Connect Wallet" Button:**
    *   Add a "Connect Wallet" button to the header of the application. The button text should dynamically update to show the user's wallet address when connected.

3.  **Initialize the Wallet Adapter:**
    *   In your main JavaScript file (`src/marketplace.js`), initialize the wallet adapter.
    *   Configure the wallets you want to support (e.g., Phantom, Solflare).
    *   Add logic to the "Connect Wallet" button to trigger the connection prompt.
    *   Listen for connection status changes to update the UI accordingly.

## HTML Example (in `marketplace.html` header)

```html
<div class="wallet-controls">
  <button id="connect-wallet-btn">Connect Wallet</button>
</div>
```

## JavaScript Example (`src/marketplace.js`)

```javascript
// This is a simplified example. Refer to Solana wallet-adapter docs for the full setup.

// Use imports if you have a build system, or window vars from CDN
const { WalletAdapterNetwork } = solanaWalletAdapter;
const {
  ConnectionProvider,
  WalletProvider,
} = solanaWalletAdapterReact;
const {
  WalletModalProvider,
  WalletMultiButton,
} = solanaWalletAdapterReactUi;

// In your main app logic
const network = WalletAdapterNetwork.Devnet;
const endpoint = web3.clusterApiUrl(network);
const wallets = [new PhantomWalletAdapter()];

// You would typically wrap your app in providers.
// For vanilla JS, you'll need to instantiate and manage the adapter manually.

const wallet = ... // initialization logic

const connectBtn = document.getElementById('connect-wallet-btn');
connectBtn.addEventListener('click', async () => {
    try {
        await wallet.connect();
    } catch (error) {
        console.error('Failed to connect wallet', error);
    }
});

wallet.on('connect', (publicKey) => {
    connectBtn.textContent = `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`;
});

wallet.on('disconnect', () => {
    connectBtn.textContent = 'Connect Wallet';
});
```
