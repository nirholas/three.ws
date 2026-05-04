# Prompt 4: Solana Pay QR Code (Frontend)

## Objective
Integrate the frontend with the new payment endpoint to display a Solana Pay QR code when a user clicks the "Purchase" button.

## Explanation
With the backend endpoint ready to generate transactions, we need to update the frontend to request this transaction and display it as a QR code. This allows users to scan the code with their mobile Solana wallet to approve the purchase. We'll use the official `@solana/pay` JavaScript library to generate the QR code.

## Instructions
1.  **Add Frontend Dependency:**
    *   Add the `@solana/pay` library to your frontend `package.json` and install it.

2.  **Create a Payment Modal:**
    *   In `marketplace.html` (or your main HTML file), create the HTML structure for a modal dialog. This modal will be hidden by default and will contain the QR code, transaction details, and a spinner.

3.  **Implement the Frontend Logic (`src/marketplace.js`):**
    *   Add a delegated event listener to the page that listens for clicks on buttons with the `purchase-skill-btn` class.
    *   When a button is clicked:
        *   Show the payment modal and a loading spinner.
        *   Get the `skillName` and `agentId` from data attributes.
        *   Make a `POST` request to your `/api/payments/prepare-skill-purchase` endpoint.
        *   On success, use the `createQR` function from `@solana/pay` to generate the QR code from the transaction URL.
        *   Mount the QR code SVG element into the modal. Hide the spinner.
        *   Display the transaction message and amount.
        *   Handle any errors from the API call by showing an error message in the modal.

## Code Example (`src/marketplace.js`)

```javascript
import { createQR } from '@solana/pay';

// ... other imports

function renderPaymentModal(url) {
    const modal = $('payment-modal'); // Assuming you have a modal element
    const qrCodeContainer = modal.querySelector('.qr-code-container');
    const spinner = modal.querySelector('.spinner');
    
    qrCodeContainer.innerHTML = '';
    spinner.hidden = true;

    const qr = createQR(url, 300, 'transparent'); // size, background color
    qr.append(qrCodeContainer);

    modal.showModal(); // Using <dialog> element's API
}

async function handlePurchaseClick(event) {
    const button = event.target.closest('.purchase-skill-btn');
    if (!button) return;

    const skillName = button.dataset.skillName;
    const agentId = $('d-id').textContent; // Assuming agent ID is available
    
    const modal = $('payment-modal');
    modal.querySelector('.spinner').hidden = false;
    modal.showModal();

    try {
        const response = await fetch('/api/payments/prepare-skill-purchase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId, skillName }),
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.statusText}`);
        }

        const { transaction, message } = await response.json();
        
        // The Solana Pay URL is constructed from the API response
        const url = `solana:${encodeURIComponent(transaction)}`;
        
        renderPaymentModal(url, message);

    } catch (error) {
        console.error('Purchase failed:', error);
        modal.querySelector('.error-message').textContent = 'Failed to prepare transaction. Please try again.';
        modal.querySelector('.spinner').hidden = true;
    }
}

document.body.addEventListener('click', handlePurchaseClick);
```

## HTML Modal Example

```html
<!-- Add this to your main HTML file -->
<dialog id="payment-modal">
    <h2>Complete Your Purchase</h2>
    <div class="spinner"></div>
    <div class="qr-code-container"></div>
    <p class="payment-message"></p>
    <p class="error-message"></p>
    <button class="close-modal-btn">Close</button>
</dialog>
```
