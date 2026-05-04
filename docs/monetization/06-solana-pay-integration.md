---
status: not-started
---

# Prompt 6: Solana Pay Integration

## Objective
Integrate the Solana Pay SDK and set up the basic client-side structure for handling skill purchases.

## Explanation
To facilitate payments, we will use Solana Pay, a standard for decentralized payments on the Solana blockchain. This prompt covers the initial setup of the Solana Pay JavaScript library and creating placeholder functions for the purchase flow.

## Instructions
1.  **Add Solana Pay SDK:**
    *   Include the Solana Pay SDK in your frontend. You can add it via a script tag from a CDN or install it as an npm package if you have a build process.
    *   For example: `<script src="https://unpkg.com/@solana/pay@0.2.4/dist/index.iife.js"></script>`

2.  **Add Solana Web3.js SDK:**
    *   Solana Pay often works in conjunction with the core Solana Web3 library. Include this as well.
    *   For example: `<script src="https://unpkg.com/@solana/web3.js@latest/lib/index.iife.js"></script>`

3.  **Create a Purchase Module:**
    *   In your frontend JavaScript for the agent detail page, create a new section or object to handle the purchase logic.
    *   This module will contain functions to initiate a purchase, create a transaction request, display a QR code, and monitor the transaction status.

4.  **Implement Placeholder Functions:**
    *   Create empty or `console.log` stub functions for the main steps:
        *   `initiatePurchase(skillName)`: Called when a user clicks a "Buy" button.
        *   `fetchTransactionRequest(skillName)`: Will call our backend to get transaction details.
        *   `displayPaymentQR(transactionUrl)`: Will use the Solana Pay SDK to generate and show a QR code.
        *   `monitorTransaction(transactionSignature)`: Will poll the blockchain to confirm the payment.

## Code Example (HTML - adding scripts in `marketplace.html`)

```html
<!-- At the end of your body tag -->
<script src="https://unpkg.com/@solana/web3.js@latest/lib/index.iife.js"></script>
<script src="https://unpkg.com/@solana/pay@0.2.4/dist/index.iife.js"></script>
<script src="/src/marketplace.js"></script> <!-- Your app's script -->
```

## Code Example (JavaScript - Purchase Module Stub)

```javascript
// In your marketplace JavaScript file

const PurchaseFlow = {
  async initiatePurchase(agent, skillName) {
    console.log(`Initiating purchase for skill: ${skillName} from agent: ${agent.name}`);

    // 1. Fetch transaction details from our backend
    const transactionUrl = await this.fetchTransactionRequest(agent.id, skillName);
    if (!transactionUrl) return;

    // 2. Display QR code for payment
    this.displayPaymentQR(transactionUrl);

    // 3. Monitor for payment completion (to be fully implemented later)
    // This part requires getting a signature, which is part of the Solana Pay flow.
    // For now, we can just log.
    console.log('Purchase flow started. Waiting for payment...');
  },

  async fetchTransactionRequest(agentId, skillName) {
    console.log('Fetching transaction request from backend...');
    // In the next step, this will make a real API call.
    // For now, it's a placeholder.
    // The backend will return a Solana Pay URL like:
    // "solana:https://your-api.com/api/purchase/transaction?agent=...&skill=..."
    // We'll stub this out later.
    showToast('Backend for transactions not implemented yet.', 'error');
    return null;
  },

  displayPaymentQR(url) {
    console.log(`Displaying QR code for URL: ${url}`);
    // This will be implemented using SolanaPay.createQR()
    // and rendered into a modal.
    showToast('QR code display not implemented yet.', 'error');
  },

  async monitorTransaction(signature) {
    console.log(`Monitoring signature: ${signature}`);
    // This will use solanaWeb3.Connection to check transaction status.
    showToast('Transaction monitoring not implemented yet.', 'error');
  }
};

// Example of how it would be called from the skill rendering logic:
// <button onclick="PurchaseFlow.initiatePurchase(...)">Buy</button>
```
