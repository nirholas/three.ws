---
status: not-started
---

# Prompt 8: Frontend - Purchase Modal with Solana Pay

**Status:** Not Started

## Objective
Create a user interface that allows users to purchase a skill NFT using their Solana wallet.

## Explanation
With the backend ready to generate purchase transactions, we need a frontend to initiate the process. This involves creating a purchase button that, when clicked, opens a modal with a Solana Pay QR code. Users can scan this with their mobile wallet or use a browser extension to approve the transaction.

## Instructions
1.  **Modify the `renderDetail` Function:**
    -   In `src/marketplace.js`, within the skill rendering loop, if a skill has a price, display a "Purchase" button instead of the price badge.

2.  **Create the Purchase Modal:**
    -   Design a modal that will display the Solana Pay QR code.
    -   The modal should show the skill name, price, and a spinning loader while waiting for the transaction.

3.  **Implement the Purchase Flow:**
    -   When a "Purchase" button is clicked:
        -   Open the purchase modal.
        -   Make a `POST` request to your `/api/skills/purchase` endpoint, sending the user's connected wallet address, the agent ID, and the skill name.
        -   The API will respond with a Solana Pay transaction request.
        -   Use a Solana Pay QR code generation library to render the QR code in the modal.
    -   **Listen for Transaction Confirmation:**
        -   The frontend should poll for the transaction's signature on the Solana blockchain.
        -   Once the transaction is confirmed, update the UI to show a success message and change the skill's button to "Owned".

## Code Example (JavaScript in `src/marketplace.js`)

```javascript
// ... inside the skill rendering loop in renderDetail ...

if (price) {
    const purchaseBtn = document.createElement('button');
    purchaseBtn.className = 'purchase-skill-btn';
    purchaseBtn.textContent = `Purchase for ${(price.amount / 1e6).toFixed(2)} USDC`;
    purchaseBtn.onclick = () => openPurchaseModal(a.id, name);
    skillEntry.appendChild(purchaseBtn);
}

// ... new function to handle the purchase flow ...

async function openPurchaseModal(agentId, skillName) {
    const modal = document.getElementById('purchase-modal');
    const qrCodeContainer = document.getElementById('qr-code');
    modal.hidden = false;
    
    const userWallet = /* get connected wallet address */;
    
    try {
        const response = await fetch('/api/skills/purchase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_account: userWallet, agent_id: agentId, skill_name: skillName }),
        });
        const { transaction, message } = await response.json();

        // Create a Solana Pay URL
        const solanaPayUrl = `solana:${encodeURIComponent(transaction)}`;
        
        // Generate and display the QR code
        const qr = QRCode.create(solanaPayUrl, { size: 256 });
        qrCodeContainer.innerHTML = '';
        qr.append(qrCodeContainer);

        // ... add logic to poll for the transaction signature ...

    } catch (error) {
        console.error('Purchase failed:', error);
        // show error in modal
    }
}
```

## Definition of Done
-   A "Purchase" button appears next to paid skills in the marketplace.
-   Clicking the button opens a modal displaying a Solana Pay QR code.
-   After the transaction is confirmed, the UI updates to reflect skill ownership.
-   The entire flow is functional on Solana devnet.
