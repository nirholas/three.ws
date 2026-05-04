---
status: not-started
---

# Prompt 6: Frontend - Handle "Buy Skill" Click

**Status:** Not Started

## Objective
Implement the frontend logic to handle clicks on the "Buy Skill" button.

## Explanation
When a user clicks the "Buy Skill" button, the frontend needs to initiate the purchase process. This involves making a `POST` request to our new `/api/skills/purchase` endpoint. The frontend will then receive a Solana Pay URL, which it will use to open a payment modal or QR code for the user to complete the transaction.

## Instructions
1.  **Add a click listener:**
    - In `src/marketplace.js`, add a global click listener or a delegated listener to the `d-skills` container.
    - Check if the clicked element has the `buy-skill-btn` class.

2.  **Make the API request:**
    - If the "Buy" button is clicked, get the `agentId` and `skillName` from the `data-` attributes.
    - Send a `POST` request to `/api/skills/purchase` with these details in the request body.
    - Handle the API response:
        - On success, you'll receive a `solanaPayUrl`.
        - On failure (e.g., already purchased), display an appropriate message to the user.

3.  **Integrate Solana Pay:**
    - Once you have the `solanaPayUrl`, use the Solana Pay QR code generator to display a QR code to the user.
    - You can use a library like `@solana/pay-qr-code` for this.
    - Display the QR code in a modal window. This will allow users to scan it with their mobile wallet to approve the transaction.

## Code Example (`src/marketplace.js`)

```javascript
// Add this logic to your main marketplace script

function handleBuySkillClick(event) {
    if (!event.target.matches('.buy-skill-btn')) {
        return;
    }

    const button = event.target;
    const { agentId, skillName } = button.dataset;

    button.disabled = true;
    button.textContent = 'Preparing...';

    fetch('/api/skills/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, skillName }),
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(err => Promise.reject(err));
        }
        return response.json();
    })
    .then(data => {
        // Assume you have a function to show a Solana Pay modal
        showSolanaPayModal(data.solanaPayUrl);
        button.textContent = 'Pay...';
    })
    .catch(err => {
        console.error('Purchase failed:', err);
        alert(err.error || 'Could not initiate purchase.');
        button.disabled = false;
        button.textContent = 'Buy';
    });
}

// Attach the listener
document.addEventListener('click', handleBuySkillClick);

// You will need to implement this modal function
function showSolanaPayModal(url) {
    // 1. Create a modal element
    // 2. Use a QR code library to generate a QR code from the URL
    // 3. Append the QR code to the modal and display it
}
```

## Verification
- Click a "Buy" button on the agent detail page.
- Verify in your browser's developer tools that the `POST` request is sent to the backend.
- Check that the backend responds with a Solana Pay URL.
- Ensure that a modal with a QR code appears.
- Try clicking "Buy" for a skill you've already purchased (if you have seeded data) and verify the error handling.
