# Prompt 8: Connect Wallet Button Logic

## Objective
Implement the logic for a custom "Connect Wallet" button inside the payment modal, abandoning the difficult-to-integrate React components from the previous prompt.

## Explanation
Since the pre-built UI components for the Solana Wallet Adapter are React-based, we'll create our own simple connection flow. This gives us more control and avoids pulling in a large framework. The flow will be:
1.  User clicks our custom "Connect Wallet" button.
2.  We'll attempt to connect to a wallet provider found in the browser (e.g., Phantom).
3.  On success, we'll update the UI to show the user's wallet address and enable the payment button.

## Instructions
1.  **Modify the Wallet Initialization:**
    *   In `src/marketplace.js`, adjust the `initWalletAdapter` function. Instead of trying to render a React component, we will just prepare the adapter instances.

2.  **Create the Connect Button Logic:**
    *   Add an event listener to the `#payment-connect-wallet-btn` inside the `openPaymentModal` function (or a separate setup function).
    *   When clicked, the handler should try to connect to the wallet adapter.
    *   Use `wallet.connect().catch(...)` to handle connection errors gracefully.

3.  **Update UI on Connection Status Change:**
    *   Create a function, e.g., `updateWalletUI()`, that checks the wallet adapter's state (`wallet.connected`, `wallet.publicKey`).
    *   If connected:
        *   Hide the "Connect Wallet" button.
        *   Display the user's public key (shortened for readability).
        *   Show a "Disconnect" button.
        *   Enable the "Confirm Purchase" button.
    *   If disconnected:
        *   Show the "Connect Wallet" button.
        *   Hide the public key and disconnect button.
        *   Disable the "Confirm Purchase" button.
    *   Call this function after connecting/disconnecting and when the modal is first opened.

4.  **Add Disconnect Logic:**
    *   Add an event listener to the "Disconnect" button to call `wallet.disconnect()`.

## Code Example (Frontend - `src/marketplace.js`)

```javascript
// --- At the top of the file ---
const { Connection, clusterApiUrl } = solanaWeb3;
const { PhantomWalletAdapter } = solanaWalletAdapterWallets;

let solanaConnection;
let wallet; // Our single wallet adapter instance

// --- Initialization ---
function initWalletAdapter() {
    solanaConnection = new Connection(clusterApiUrl('mainnet-beta'));
    wallet = new PhantomWalletAdapter(); // We'll specifically use Phantom for simplicity

    // Listen for connection changes
    wallet.on('connect', () => {
        console.log('Wallet connected!');
        updateWalletUI();
    });
    wallet.on('disconnect', () => {
        console.log('Wallet disconnected!');
        updateWalletUI();
    });
}

// --- UI Update Logic ---
function updateWalletUI() {
    const walletArea = $('payment-wallet-area');
    const confirmBtn = $('payment-confirm-btn');

    if (wallet.connected) {
        const pubKey = wallet.publicKey.toBase58();
        walletArea.innerHTML = `
            <p>Connected: <strong>${pubKey.slice(0, 4)}...${pubKey.slice(-4)}</strong></p>
            <button class="btn-secondary" id="payment-disconnect-btn">Disconnect</button>
        `;
        $('payment-disconnect-btn').addEventListener('click', () => wallet.disconnect());
        confirmBtn.disabled = false;
    } else {
        walletArea.innerHTML = `
            <button class="btn-primary" id="payment-connect-wallet-btn">Connect Phantom Wallet</button>
        `;
        $('payment-connect-wallet-btn').addEventListener('click', async () => {
            const btn = $('payment-connect-wallet-btn');
            btn.textContent = 'Connecting...';
            btn.disabled = true;
            try {
                await wallet.connect();
            } catch (error) {
                console.error("Failed to connect wallet", error);
                btn.textContent = 'Connect Phantom Wallet'; // Reset on failure
                btn.disabled = false;
            }
        });
        confirmBtn.disabled = true;
    }
}

// --- In the main `init()` function ---
initWalletAdapter();

// --- When opening the modal ---
function openPaymentModal(intent, skillName) {
    // ... (previous code to populate skill name, price, etc.)

    updateWalletUI(); // Set the initial state of the wallet UI
    $('payment-modal-overlay').hidden = false;
}
```
