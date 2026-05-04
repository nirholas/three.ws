---
status: not-started
---

# Prompt 16: Frontend Purchase Modal

**Status:** Not Started

## Objective
Create a modal dialog on the frontend that appears when a user clicks the "Buy" button, displaying a Solana Pay QR code for the transaction.

## Explanation
The purchase modal is the heart of the user-facing payment flow. It needs to be clean, clear, and easy to use. It will fetch the Solana Pay transaction request from our backend and display it as a QR code that mobile wallets can scan, or provide a link for desktop wallets.

## Instructions
- [ ] **Add a hidden modal to `marketplace.html`:**
    - [ ] Create the HTML structure for the modal, including a space for the QR code, a title, price details, and a close button. Initially, it should be hidden with CSS.
- [ ] **Add a click listener for the `.btn-buy` buttons.**
- [ ] **When a "Buy" button is clicked:**
    - [ ] Get the `agentId` and `skillName` from the button's `data-` attributes.
    - [ ] Show the modal and display a loading spinner.
    - [ ] Make a `POST` request to your `/api/payments/solana-pay` endpoint.
    - [ ] The backend will respond with a Solana Pay URL (the `transaction` field from Prompt 5).
- [ ] **Generate and Display QR Code:**
    - [ ] Use a client-side QR code generation library (like `qr-code-styling`) to turn the Solana Pay URL into a QR code and display it in the modal.
    - [ ] Also provide a clickable link for desktop users.

## Code Example (JavaScript using a QR library)

```javascript
import QRCodeStyling from 'qr-code-styling';

// ... listener for .btn-buy clicks ...
async function onBuyClick(agentId, skillName) {
    showModal(); // Show modal with a loading state
    const modalBody = document.getElementById('purchase-modal-body');

    try {
        const res = await fetch('/api/payments/solana-pay', {
            method: 'POST',
            body: JSON.stringify({ agentId, skillName }),
        });
        const solanaPayRequest = await res.json();
        const solanaPayUrl = solanaPayRequest.transaction; // This is the URL to encode

        const qrCode = new QRCodeStyling({
            width: 300,
            height: 300,
            data: solanaPayUrl,
            // ... styling options
        });

        modalBody.innerHTML = ''; // Clear loader
        qrCode.append(modalBody);
        modalBody.innerHTML += `<a href="${solanaPayUrl}">Open in Wallet</a>`;

    } catch (err) {
        modalBody.innerHTML = 'Error creating transaction. Please try again.';
    }
}
```
