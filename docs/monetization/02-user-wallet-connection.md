---
status: not-started
---
# Prompt 2: User Wallet Connection

## Objective
Integrate a "Connect Wallet" feature into the marketplace header, allowing users to connect their Solana wallets to the application. This is a foundational step for enabling on-chain interactions like purchasing skills.

## Explanation
To allow users to purchase premium skills, they first need a way to connect their cryptocurrency wallet. We will use a vanilla JavaScript implementation compatible with the Solana wallet-adapter standards to present a "Connect Wallet" button. This will handle the core logic of connecting to browser-based wallets like Phantom.

## Instructions
- [ ] **Add a Wallet Library:**
    - [ ] We will use a CDN version of a suitable library to simplify dependencies. Add this to `marketplace.html` in the `<head>` section:
        ```html
        <script src="https://unpkg.com/@solana/web3.js@latest/lib/index.iife.js"></script>
        ```

- [ ] **Update the Marketplace Header:**
    - [ ] In `marketplace.html`, add a "Connect Wallet" button to the header section. We will give it a unique ID to attach our script to it.
    - [ ] `<button id="connectWalletBtn" class="connect-wallet-btn">Connect Wallet</button>`

- [ ] **Implement Wallet Connection Logic:**
    - [ ] Create a new file `public/wallet-connector.js` to encapsulate the wallet connection logic.
    - [ ] This script will check for the presence of a Solana wallet in the browser (like Phantom), handle the connection request, and update the UI to reflect the connection status.

## Code Example (`public/wallet-connector.js`)

```javascript
document.addEventListener('DOMContentLoaded', () => {
    const connectWalletBtn = document.getElementById('connectWalletBtn');
    let walletPublicKey = null;

    const getProvider = () => {
        if ('phantom' in window) {
            const provider = window.phantom?.solana;
            if (provider?.isPhantom) {
                return provider;
            }
        }
        // Add other wallet providers here if needed
        return null;
    };

    const updateUI = () => {
        if (walletPublicKey) {
            const key = walletPublicKey.toBase58();
            connectWalletBtn.textContent = `Connected: ${key.slice(0, 4)}...${key.slice(-4)}`;
            connectWalletBtn.disabled = true;
        } else {
            connectWalletBtn.textContent = 'Connect Wallet';
            connectWalletBtn.disabled = false;
        }
    };

    connectWalletBtn.addEventListener('click', async () => {
        const provider = getProvider();
        if (provider) {
            try {
                const resp = await provider.connect();
                walletPublicKey = resp.publicKey;
                updateUI();

                provider.on('disconnect', () => {
                    walletPublicKey = null;
                    updateUI();
                });
            } catch (err) {
                console.error('Failed to connect to wallet', err);
                alert('Could not connect to wallet. Please try again.');
            }
        } else {
            alert('Solana wallet not found! Please install Phantom Wallet.');
            window.open('https://phantom.app/', '_blank');
        }
    });

    // Check for eager connection
    const provider = getProvider();
    if (provider && provider.isConnected) {
        // Will be null if not connected
        walletPublicKey = provider.publicKey;
        updateUI();
    }
});
```

## CSS Example (`/public/marketplace.css`)

```css
.connect-wallet-btn {
  background-color: var(--accent, #6a5cff);
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  font-size: 13px;
  transition: filter 0.15s ease;
}

.connect-wallet-btn:hover {
  filter: brightness(1.1);
}

.connect-wallet-btn:disabled {
  background-color: #3a3a4a;
  cursor: not-allowed;
}
```
