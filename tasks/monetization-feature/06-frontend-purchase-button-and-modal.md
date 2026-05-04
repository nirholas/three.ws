---
status: completed
---

# Prompt 6: Frontend - "Purchase Skill" Button & Modal

**Status:** Not Started

## Objective
On the agent detail page, display a "Purchase" button for paid skills, which, when clicked, opens a modal with a Solana Pay QR code for the transaction.

## Explanation
Now that the backend can prepare a purchase transaction, the frontend needs to trigger it. This involves changing the UI to show a clear call-to-action for purchasing a skill. Using a modal with a QR code is a standard and user-friendly way to handle crypto payments, as it works seamlessly for both desktop (scanning with a mobile wallet) and mobile users (opening a wallet app directly).

## Instructions
- [ ] **Modify Skill Rendering Logic:** In `src/marketplace.js` (inside `renderDetail`), update the logic that creates skill badges.
    - If a skill has a price and is not yet owned by the user, render a `<button class="purchase-btn">`.
    - Store the `agent_id` and `skill_name` in data attributes on the button (e.g., `data-agent-id="..."`, `data-skill-name="..."`).
- [ ] **Create a Modal:** In `marketplace.html`, add the HTML structure for a modal dialog. It should be hidden by default and contain an element for the QR code and some instructional text.
- [ ] **Add Event Listener:**
    - Attach a click event listener to the `.purchase-btn` buttons.
    - When a button is clicked, prevent the default action, and read the `agent_id` and `skill_name` from the data attributes.
- [ ] **Implement Solana Pay QR Code Generation:**
    - Use the `@solana/pay` frontend library.
    - Inside the event listener, construct the URL for the purchase API (`/api/purchase/skill?agent_id=...&skill_name=...`). This URL is what the wallet will interact with.
    - Use the library to generate a QR code from this URL.
    - Append the generated QR code (it's an `<img>` or `<canvas>` element) to the modal and display the modal.

## Code Example (`src/marketplace.js`)
```javascript
import { createQR } from '@solana/pay';
import { escapeHtml } from './utils'; // Assuming you have this

// ... inside renderDetail function
$('d-skills').innerHTML = skillsArr.map(s => {
    const name = s.name || s;
    const price = skillPrices[name];
    const isOwned = userOwnedSkills.includes(name); // Assume you have this data

    let badge;
    if (isOwned) {
        badge = `<span class="price-badge price-owned">Owned</span>`;
    } else if (price) {
        badge = `<button class="purchase-btn" data-agent-id="${a.id}" data-skill-name="${name}">
                   ${(price.amount / 1e6).toFixed(2)} USDC
                 </button>`;
    } else {
        badge = `<span class="price-badge price-free">Free</span>`;
    }
    return `<span class="skill-entry">${escapeHtml(name)}${badge}</span>`;
}).join(' ');

// Add the event listener after rendering
addPurchaseButtonListeners();


function addPurchaseButtonListeners() {
    const qrCodeContainer = document.getElementById('qr-code-container');
    const purchaseModal = document.getElementById('purchase-modal');

    document.querySelectorAll('.purchase-btn').forEach(button => {
        button.addEventListener('click', (event) => {
            const agentId = event.target.dataset.agentId;
            const skillName = event.target.dataset.skillName;

            // URL for the API endpoint from Prompt 5
            const url = new URL(`${window.location.origin}/api/purchase/skill`);
            url.searchParams.append('agent_id', agentId);
            url.searchParams.append('skill_name', skillName);

            // Generate QR Code
            const qr = createQR(url, 256, 'transparent'); // size, background
            
            // Display modal
            qrCodeContainer.innerHTML = '';
            qr.append(qrCodeContainer);
            purchaseModal.style.display = 'block';
        });
    });
}
```
