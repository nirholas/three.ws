---
status: not-started
---

# Prompt 9: Frontend - Integrate Solana Pay QR Code

## Objective
Connect the purchase modal to the backend, generate a Solana Pay QR code, and display it to the user.

## Explanation
This prompt links our frontend UI to the backend payment logic. When a user clicks "Purchase", we will call the API created in the previous step, receive the Solana Pay URL, and render it as a QR code within the modal. This is the core of the user-facing payment experience.

## Instructions
1.  **Add a QR Code Library:**
    *   Install a library to generate QR codes, such as `qrious`. You can add it via a script tag or install it via npm.

2.  **Handle the Purchase Click:**
    *   In `src/marketplace.js`, add an event listener to the "Purchase" button in the modal (`purchase-modal-cta`).
    *   When clicked, it should:
        *   Show a loading state in the modal status area.
        *   Make a `POST` request to your `/api/payments/create-transaction` endpoint, sending the `skillId` and the user's connected wallet address.
        *   On success, receive the `solanaPayUrl` and `reference`.

3.  **Render the QR Code:**
    *   Use the QR code library to generate a QR code from the `solanaPayUrl`.
    *   Display the QR code in the modal, replacing the "Purchase" button.
    *   Update the status text to "Scan with your Solana wallet to approve."

## Code Example (`src/marketplace.js`)

```javascript
// Add QR library to marketplace.html
// <script src="https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js"></script>

async function handlePurchaseClick(event) {
    const cta = event.target;
    const { skillName, amount, mint } = cta.dataset;
    const statusEl = $('purchase-modal-status');
    const modalBody = $('purchase-modal').querySelector('.modal-body');

    statusEl.textContent = 'Generating transaction...';
    cta.disabled = true;

    try {
        const res = await fetch('/api/payments/create-transaction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                skillId: getSkillIdByName(skillName), // You'll need a way to get the ID
                buyerAddress: window.userWallet.publicKey.toBase58(), // Assuming wallet is connected
            }),
        });

        if (!res.ok) throw new Error('Failed to create transaction');

        const { solanaPayUrl, reference } = await res.json();

        // Hide description, price, etc. to make space for QR
        modalBody.innerHTML = `
            <div id="qr-code-container" style="text-align: center;"></div>
            <div class="status-area">Scan with your Solana wallet to approve.</div>
        `;

        // Render QR code
        new QRious({
            element: $('qr-code-container'),
            value: solanaPayUrl,
            size: 200,
            background: 'white',
            foreground: 'black',
        });

        // Start polling for transaction confirmation
        pollForTransaction(reference);

    } catch (error) {
        statusEl.textContent = `Error: ${error.message}`;
        cta.disabled = false;
    }
}

// Attach listener
$('purchase-modal-cta').addEventListener('click', handlePurchaseClick);
```
