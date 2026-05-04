---
status: not-started
---
# Prompt 3: Solana Pay Integration for Skill Purchases

## Objective
Integrate Solana Pay to allow users to purchase skills using a QR code or wallet deeplink.

## Explanation
We need a robust payment mechanism. Solana Pay is a standard for on-chain payments that provides a great user experience on both desktop and mobile. When a user clicks "Purchase," we will generate a Solana Pay QR code that encodes the transaction details (recipient, amount, currency).

## Instructions
1.  **Add Solana Pay Library:**
    *   Add the `@solana/pay` library to your frontend dependencies using npm: `npm install @solana/pay`.

2.  **Create a Payment Request API:**
    *   Create a new backend endpoint, e.g., `/api/payments/request`.
    *   This endpoint should take `agentId` and `skillName` as input.
    *   It should look up the skill's price and the creator's payout address from the database.
    *   Generate a unique reference key (a new Solana public key) for the transaction and store it in a `skill_purchases` table with a `pending` status. This reference will be used for verification later.
    *   The endpoint should return a JSON object containing the `recipient` address, `amount`, `splToken` (mint address for USDC), and the `reference` key as a string.

3.  **Generate QR Code on Frontend:**
    *   In `src/marketplace.js`, add a click handler to the "Purchase" buttons.
    *   When a button is clicked, call the `/api/payments/request` endpoint.
    *   Use the response data and the `@solana/pay` library to generate a Solana Pay URL.
    *   Display a modal with a QR code generated from this URL. The library provides utilities for this.
    *   The modal should also include a "Pay with Wallet" button for mobile users, which creates a `solana:PAY_URL` deeplink.

## Code Example (Frontend - `src/marketplace.js`)
```javascript
import { createQR, encodeURL } from '@solana/pay';
import { PublicKey } from '@solana/web3.js';
import BigNumber from 'bignumber.js';

// ... inside the purchase button click handler ...

const skillName = button.dataset.skillName;
const agentId = currentAgent.id;

try {
    const { recipient, amount, splToken, reference } = await post('/api/payments/request', { agentId, skillName });

    const url = encodeURL({
        recipient: new PublicKey(recipient),
        amount: new BigNumber(amount).dividedBy(1e6), // Convert from lamports to token units
        splToken: new PublicKey(splToken),
        reference: new PublicKey(reference),
        label: `3D-Agent Skill Purchase`,
        message: `Skill: ${skillName} for Agent: ${agentId}`,
    });

    // --- Render Modal with QR Code ---
    const qr = createQR(url);
    const modal = document.getElementById('payment-modal');
    const qrContainer = modal.querySelector('.qr-code-container');
    qrContainer.innerHTML = '';
    qr.append(qrContainer);
    modal.style.display = 'block';

} catch (error) {
    console.error('Payment request failed', error);
    // Show an error message to the user
}
```
