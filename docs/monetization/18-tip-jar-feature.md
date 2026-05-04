---
status: not-started
---

# Prompt 18: Tip Jar Feature

## Objective
Add a simple "Tip" button and flow to the agent detail page, allowing users to send a custom amount of SOL or USDC to the agent's creator.

## Explanation
A tip jar is a straightforward way to let appreciative users support creators without the commitment of a subscription. This feature leverages the existing Solana Pay infrastructure for a simple, one-off payment.

## Instructions
1.  **Add UI Elements:**
    *   On the agent detail page (`marketplace.html`), add a "Send a Tip" button, perhaps near the agent's name or creator details.
    *   Clicking this button should open a small modal.
    *   The modal should contain:
        *   An input field for the amount.
        *   A dropdown to select the currency (e.g., SOL, USDC).
        *   A "Generate Payment QR" button.

2.  **Create a Backend Endpoint for Tip Transactions:**
    *   Create a new endpoint, e.g., `GET /api/tip/transaction`.
    *   This endpoint will take `agentId`, `amount`, and `currency` as query parameters.
    *   The logic will be very similar to the skill purchase endpoint:
        *   Fetch the agent owner's wallet address.
        *   Generate a `reference` keypair for tracking.
        *   Construct the Solana Pay details URL.
        *   Return the `solana:...` URL and the `reference` public key.

3.  **Create the Solana Pay Details Endpoint:**
    *   Create the corresponding `POST /api/tip/details` endpoint.
    *   This will receive the user's wallet and build the appropriate transaction (either a `SystemProgram.transfer` for SOL or an `splToken.createTransferInstruction` for USDC).
    *   The amount will be read from the query parameters passed along in the details URL.
    *   Return the serialized transaction in the Solana Pay format.

4.  **Implement Frontend Logic:**
    *   Wire up the "Send a Tip" button to open the modal.
    *   When the user clicks "Generate Payment QR" inside the modal:
        *   Read the amount and currency from the form.
        *   Call the `/api/tip/transaction` endpoint with these parameters.
        *   Receive the Solana Pay URL and display it as a QR code in the modal.
        *   You can optionally add a polling mechanism to confirm the tip was received and show a "Thank you" message.

## Code Example (Tip Modal HTML)

```html
<div id="tip-modal" class="modal-backdrop">
  <div class="modal-content">
    <div class="modal-header"><h3>Send a Tip</h3></div>
    <div class="modal-body">
      <div class="form-group">
        <label>Amount</label>
        <input type="number" id="tip-amount" placeholder="1.0">
      </div>
      <div class="form-group">
        <label>Currency</label>
        <select id="tip-currency">
          <option value="SOL">SOL</option>
          <option value="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7uP3">USDC</option>
        </select>
      </div>
      <button id="generate-tip-qr-btn" class="cta-button">Generate Payment Code</button>
      <div id="tip-qr-container" style="margin-top: 16px;"></div>
    </div>
  </div>
</div>
```

## Code Example (Frontend JavaScript)

```javascript
document.getElementById('generate-tip-qr-btn').addEventListener('click', async () => {
  const amount = document.getElementById('tip-amount').value;
  const currency = document.getElementById('tip-currency').value;
  const agentId = /* get current agent ID */;

  if (!amount || parseFloat(amount) <= 0) {
    showToast('Please enter a valid amount.', 'error');
    return;
  }

  try {
    const response = await fetch(`/api/tip/transaction?agentId=${agentId}&amount=${amount}&currency=${currency}`);
    const { url } = await response.json();

    const qrContainer = document.getElementById('tip-qr-container');
    qrContainer.innerHTML = '';
    const qr = SolanaPay.createQR(url, 250);
    qrContainer.appendChild(qr.canvas);

  } catch (e) {
    showToast('Could not generate payment code.', 'error');
  }
});
```
