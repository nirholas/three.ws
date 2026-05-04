---
status: not-started
---

# Prompt 5: Frontend - Solana Pay Integration

## Objective
Integrate the frontend "Purchase" button with the backend Solana Pay endpoint to generate and display a payment QR code.

## Explanation
This task connects the user's purchase action to the on-chain transaction. When a user clicks the "Purchase" button, the frontend will call the new Solana Pay endpoint, retrieve the transaction details, and then use a library to display a QR code. This allows users with mobile wallets to scan and approve the payment seamlessly.

## Instructions
1.  **Add Solana Pay Library:**
    *   Include the Solana Pay QR code generation library in your project. You can use the official `@solana/pay` and a QR code library.
    *   Run `npm install @solana/pay qrcode`.

2.  **Create a Modal Component:**
    *   In your main HTML file (e.g., `marketplace.html`), add the structure for a modal dialog that will contain the QR code. It should be hidden by default.

3.  **Implement Click Handler:**
    *   In `src/marketplace.js`, add a click event listener to the `d-skills` container (or use event delegation).
    *   The handler should trigger only for clicks on `.purchase-btn`.

4.  **Fetch Transaction and Generate QR:**
    *   Inside the click handler, retrieve the `skill_name` and `agent_id` from the button's `data-*` attributes.
    *   Make a `POST` request to `/api/payments/solana-pay` with this data.
    *   The response will contain the Solana Pay URL. Use the `qrcode` library to generate a QR code from this URL.
    *   Inject the QR code into your modal and display it.

## Code Example (`src/marketplace.js`)

```javascript
import QRCode from 'qrcode';

// ... other code ...

async function handlePurchaseClick(e) {
  if (!e.target.matches('.purchase-btn')) return;

  const btn = e.target;
  const { skill, agent } = btn.dataset;

  // Show a loading spinner
  btn.disabled = true;

  try {
    const res = await fetch('/api/payments/solana-pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agent, skill_name: skill }),
    });

    if (!res.ok) throw new Error('Failed to create transaction');

    const { transaction, message } = await res.json();
    const solanaPayUrl = `solana:${transaction}?label=${encodeURIComponent(message)}`;

    // Generate QR and show modal
    const qrCanvas = document.getElementById('qr-canvas');
    await QRCode.toCanvas(qrCanvas, solanaPayUrl, { width: 256 });
    document.getElementById('payment-modal').style.display = 'block';

  } catch (err) {
    console.error('Purchase failed:', err);
    // Show an error message
  } finally {
    btn.disabled = false;
  }
}

$('d-skills').addEventListener('click', handlePurchaseClick);
```
