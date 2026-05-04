# Prompt 2: Add "Connect Wallet" Button

## Status
- [x] Completed

## Objective
Integrate a "Connect Wallet" button into the main application header, which will serve as the entry point for users to connect their Solana wallets.

## Explanation
Before a user can purchase a skill, they must connect their Solana wallet. This prompt focuses on adding the UI element for wallet connection and setting up the initial event listeners. The actual wallet connection logic will be handled in a subsequent step.

## Instructions
1.  **Update the main HTML layout:**
    *   Locate the primary header or navigation component in `app.html`.
    *   Add a new button with the ID `connect-wallet-btn`.
    *   Initially, the button text should be "Connect Wallet". After a successful connection, this text will change to the user's wallet address.

2.  **Create a dedicated wallet management module:**
    *   Create a new file: `src/wallet.js`.
    *   This module will encapsulate all wallet-related functionality (connecting, disconnecting, getting the current user's address, etc.).
    *   Create an initialization function, e.g., `initWalletButton`, that adds a click event listener to the new button.

3.  **Integrate the wallet module into the main application:**
    *   In your main application entry point (`src/main.js` or similar), import and call the `initWalletButton` function to activate the button.

## Code Example (app.html)
```html
<!-- Inside the header element -->
<div class="header-actions">
    <button id="connect-wallet-btn">Connect Wallet</button>
</div>
```

## Code Example (src/wallet.js)
```javascript
// src/wallet.js

// Placeholder for wallet adapter logic
let wallet; 

function onConnectWallet() {
  console.log('Attempting to connect wallet...');
  // The actual connection logic will be implemented in the next prompt.
  // For now, we can simulate a successful connection.
  const mockAddress = 'YourWalletAddress...';
  updateWalletState(mockAddress);
}

export function updateWalletState(address) {
  const btn = document.getElementById('connect-wallet-btn');
  if (address) {
    // Display shortened address
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
}
```

## Code Example (src/main.js)
```javascript
// src/main.js
import { initWalletButton } from './wallet.js';

document.addEventListener('DOMContentLoaded', () => {
  // ... other initializations
  initWalletButton();
});
```
