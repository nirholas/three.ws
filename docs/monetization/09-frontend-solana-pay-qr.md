---
status: not-started
---

# Prompt 9: Frontend Solana Pay QR Code

## Objective
Implement the frontend logic to display the Solana Pay QR code in the payment modal and handle user interaction.

## Explanation
Once the frontend receives the Solana Pay URL from the backend, it needs to use the Solana Pay SDK to render it as a scannable QR code. This prompt covers the client-side rendering and the beginning of the payment monitoring loop.

## Instructions
1.  **Update `fetchTransactionRequest`:**
    *   In the `PurchaseFlow` module, modify the `fetchTransactionRequest` function.
    *   It should now make a real `fetch` call to your new backend endpoint (`/api/purchase/transaction`).
    *   It should expect a JSON response like `{ url: "solana:..." }` and return the URL.

2.  **Implement `displayPaymentQR`:**
    *   This function will take the Solana Pay URL as an argument.
    *   Get the QR code container element from the payment modal.
    *   Use the `SolanaPay.createQR()` function from the SDK to generate the QR code. This function takes a URL and optional parameters for size and background color.
    *   Append the generated QR code (which is an `HTMLDivElement`) to your container.
    *   Populate the modal with skill name and price information.
    *   Finally, call `showPaymentModal()` to reveal the modal to the user.

3.  **Start the Monitoring Loop:**
    *   The Solana Pay QR code flow includes a reference keypair that allows you to find the transaction once it's been confirmed.
    *   The `createQR` function can help with this. The Solana Pay spec involves the wallet calling your API, and your API finding the transaction.
    *   A simple way to start is to begin polling a "check status" endpoint on your backend after displaying the QR code.
    *   Modify `initiatePurchase` to start a `setInterval` loop that calls a new function, e.g., `checkPaymentStatus()`.

## Code Example (JavaScript - `PurchaseFlow` module)

```javascript
const PurchaseFlow = {
  // ... other functions
  currentPurchase: null, // To store state between steps

  async initiatePurchase(agent, skillName) {
    // Store context for use in other functions
    this.currentPurchase = { agent, skillName, reference: null };

    // Get the Solana Pay URL from our server
    const response = await fetch(`/api/purchase/transaction?agentId=${agent.id}&skillName=${encodeURIComponent(skillName)}`);
    if (!response.ok) {
      showToast('Error creating transaction.', 'error');
      return;
    }
    const { url, reference } = await response.json(); // Assume backend also returns the reference public key
    this.currentPurchase.reference = new solanaWeb3.PublicKey(reference);

    this.displayPaymentQR(url, agent, skillName);

    // Start checking for the transaction confirmation
    this.startMonitoring();
  },

  displayPaymentQR(url, agent, skillName) {
    const qrContainer = document.getElementById('payment-qr-container');
    qrContainer.innerHTML = ''; // Clear previous QR code

    // Use the Solana Pay SDK to create the QR code element
    const qr = SolanaPay.createQR(url, 300, 'white', 'black');
    qrContainer.appendChild(qr.canvas);

    // Update modal text
    const price = agent.skill_prices[skillName];
    document.getElementById('payment-skill-name').textContent = skillName;
    document.getElementById('payment-skill-price').textContent = `${(price.amount / 1e6).toFixed(2)} USDC`;

    // Show the modal
    showPaymentModal();
  },

  startMonitoring() {
    this.stopMonitoring(); // Clear any existing interval
    this.monitoringInterval = setInterval(async () => {
      try {
        // This will be a new backend endpoint
        const response = await fetch(`/api/purchase/status?reference=${this.currentPurchase.reference.toBase58()}`);
        const data = await response.json();

        if (data.status === 'confirmed') {
          this.stopMonitoring();
          showToast('Payment confirmed!', 'success');
          hidePaymentModal();
          // TODO: Refresh UI to show the skill as "Purchased"
        } else if (data.status === 'expired') {
          this.stopMonitoring();
          showToast('Transaction expired.', 'error');
          hidePaymentModal();
        }
      } catch (e) {
        console.error('Error checking payment status:', e);
      }
    }, 2000); // Poll every 2 seconds
  },

  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }
};

// Ensure monitoring stops when the modal is closed manually
document.getElementById('payment-modal-close').addEventListener('click', () => {
  PurchaseFlow.stopMonitoring();
  hidePaymentModal();
});
```
