---
status: not-started
---

# Prompt 4: Wallet Connection

## Objective
Integrate a Solana wallet adapter to allow users to connect their wallets, a prerequisite for making payments.

## Explanation
To purchase skills, users will need to connect their Solana wallet (like Phantom or Solflare). We will use the official Solana wallet-adapter library to handle the complexities of wallet detection and connection. The connection button will be placed inside the purchase modal.

## Instructions
- [ ] **Add Solana Wallet-Adapter Dependencies:**
  - [ ] Add the necessary Solana wallet-adapter packages to your `package.json`. You'll need `@solana/wallet-adapter-base`, `@solana/wallet-adapter-react` (or a vanilla JS equivalent if not using a framework), and adapters for specific wallets like `@solana/wallet-adapter-wallets`. For a vanilla JS project, you may need to use a CDN version or bundle it.
- [ ] **Integrate Wallet-Adapter:**
  - [ ] In `src/marketplace.js`, initialize the wallet adapter.
  - [ ] Create a `connectWallet` function. This function will be responsible for presenting the user with a list of available wallets and handling the connection logic.
- [ ] **Add Connect Button to UI:**
  - [ ] In the purchase modal, instead of a simple "Confirm" button, we'll now have a "Connect Wallet" button if the user's wallet is not already connected.
  - [ ] Display the user's public key (wallet address) once connected, and change the button to "Proceed to Payment".

## Code Example (`src/marketplace.js`)

This example assumes you're able to import or include the wallet-adapter libraries. For simplicity, we'll use psuedo-code for the adapter initialization.

```javascript
// Assume walletAdapter is initialized somewhere in your app's entry point.
// This is a simplified example. Refer to wallet-adapter docs for full setup.

let connectedWallet = null;

async function connectWallet() {
    try {
        // This would typically open the wallet adapter's modal
        const wallet = await walletAdapter.connect();
        connectedWallet = wallet;
        console.log('Wallet connected:', wallet.publicKey.toBase58());
        updateModalAfterConnect();
    } catch (error) {
        console.error('Failed to connect wallet:', error);
        // Show an error to the user
    }
}

function updateModalAfterConnect() {
    const walletAddress = connectedWallet.publicKey.toBase58();
    const truncatedAddress = `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;
    
    // Update the modal body to show connected status
    const modalBody = $('modal-body');
    modalBody.innerHTML = `
        <p>Wallet Connected: <strong>${truncatedAddress}</strong></p>
        <button id="proceed-to-payment-btn">Proceed to Payment</button>
    `;
}

// In your event listener for showing the modal:
function showPurchaseModal(skillName) {
    let content = '';
    if (connectedWallet) {
        content = `
            <p>You are purchasing "${skillName}". Your wallet is connected.</p>
            <button id="proceed-to-payment-btn">Proceed to Payment</button>
        `;
    } else {
        content = `
            <p>You need to connect your wallet to purchase "${skillName}".</p>
            <button id="connect-wallet-btn">Connect Wallet</button>
        `;
    }
    showModal(`Purchase Skill: ${skillName}`, content);
}

// Add event listener for the new buttons inside the modal
$('modal-body').addEventListener('click', (e) => {
    if (e.target.id === 'connect-wallet-btn') {
        connectWallet();
    }
    if (e.target.id === 'proceed-to-payment-btn') {
        // Next step: initiate the payment
    }
});
```
