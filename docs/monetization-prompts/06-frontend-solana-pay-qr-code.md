# Prompt 06: Solana Pay Integration for QR Code

## Objective
Integrate Solana Pay on the frontend to generate a payment QR code when a user decides to buy a skill.

## Explanation
Solana Pay provides a seamless mobile payment experience. After the backend creates a pending purchase and returns the transaction details, the frontend needs to use those details to construct a Solana Pay URL and display it as a QR code. This allows the user to approve the transaction from their mobile wallet.

## Instructions
1.  **Add a QR Code Library:**
    *   Install a client-side QR code generation library. `qrcode` is a popular choice.
    *   `npm install qrcode`

2.  **Create a Purchase Modal:**
    *   In `marketplace.html`, create a hidden modal element that will display the QR code.
    *   This modal should have a canvas element for the QR code and show the price and skill name.

3.  **Implement QR Code Generation:**
    *   In `src/marketplace.js`, create a function, e.g., `showPurchaseModal(txDetails)`.
    *   This function will be called with the response from the `/api/marketplace/purchase` endpoint.
    *   **Construct Solana Pay URL:** Create a URL according to the Solana Pay spec. The URL will be `solana:<recipient>?amount=<amount>&spl-token=<splToken>&reference=<reference>&label=<label>`.
    *   **Render QR Code:** Use the `qrcode` library to render the Solana Pay URL into the modal's canvas.
    *   **Show the Modal:** Make the purchase modal visible to the user.

## Code Example (`src/marketplace.js`)

```javascript
import QRCode from 'qrcode';

// ... inside the event listener for a "Buy Skill" button

async function onBuySkill(agentId, skillId) {
    // 1. Call the initiate purchase API
    const res = await fetch('/api/marketplace/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId, skill_id: skillId }),
    });
    const txDetails = await res.json();

    // 2. Show the purchase modal
    showPurchaseModal(txDetails);
}

function showPurchaseModal(txDetails) {
    const modal = $('purchase-modal');
    const canvas = $('qr-canvas');
    
    const url = new URL(`solana:${txDetails.recipient}`);
    url.searchParams.set('amount', txDetails.amount);
    url.searchParams.set('spl-token', txDetails.splToken);
    url.searchParams.set('reference', txDetails.reference);
    url.searchParams.set('label', txDetails.label);

    QRCode.toCanvas(canvas, url.toString(), (error) => {
        if (error) console.error(error);
        console.log('QR code generated!');
    });

    modal.hidden = false;
    // Start polling for transaction confirmation... (covered in next prompt)
}
```
