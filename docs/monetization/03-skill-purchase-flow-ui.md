# Prompt 3: Skill Purchase Flow UI

## Objective
Implement the UI flow for purchasing a skill. When a user clicks on a paid skill on the agent detail page, a confirmation modal should appear displaying the skill name, price, and a "Buy Now" button.

## Explanation
After connecting their wallet, the next step is for users to be able to initiate a purchase. This task focuses on creating the frontend modal that serves as the confirmation step before creating and sending the on-chain transaction. This modal prevents accidental purchases and provides a clear summary of the transaction to the user.

## Instructions
1.  **Create the Purchase Modal HTML:**
    *   In `marketplace.html`, add the HTML structure for a modal dialog. It should be hidden by default.
    *   The modal should have placeholders for the skill name, price, and action buttons.

2.  **Add Event Listeners:**
    *   In `src/marketplace.js`, modify the `renderDetail` function. When rendering skills, attach a click event listener to the skill entries.
    *   If a clicked skill is paid, the event listener should populate the purchase modal with the skill's data (name, price) and make the modal visible.

3.  **Style the Modal:**
    *   In `/public/marketplace.css`, add CSS rules to style the modal, its backdrop, and content to match the site's aesthetic.

## HTML Example (`marketplace.html`)

```html
<!-- Add this somewhere inside the <body> tag -->
<div id="purchaseModal" class="modal-backdrop" style="display: none;">
    <div class="modal-content">
        <div class="modal-header">
            <h2>Confirm Purchase</h2>
            <button id="closePurchaseModal" class="modal-close-btn">&times;</button>
        </div>
        <div class="modal-body">
            <p>You are about to purchase the skill:</p>
            <h3 id="modalSkillName"></h3>
            <p>Price:</p>
            <h3 id="modalSkillPrice"></h3>
        </div>
        <div class="modal-footer">
            <button id="confirmPurchaseBtn" class="modal-action-btn">Buy Now</button>
        </div>
    </div>
</div>
```

## JavaScript Logic (`src/marketplace.js`)

```javascript
// Inside renderDetail or a suitable scope
const purchaseModal = document.getElementById('purchaseModal');
const closePurchaseModalBtn = document.getElementById('closePurchaseModal');
const confirmPurchaseBtn = document.getElementById('confirmPurchaseBtn');
const modalSkillName = document.getElementById('modalSkillName');
const modalSkillPrice = document.getElementById('modalSkillPrice');

function openPurchaseModal(skillName, price) {
    modalSkillName.textContent = skillName;
    modalSkillPrice.textContent = `${(price.amount / 1e6).toFixed(2)} USDC`;
    purchaseModal.style.display = 'flex';
    // Store data for the next step
    confirmPurchaseBtn.dataset.skillName = skillName; 
}

function closePurchaseModal() {
    purchaseModal.style.display = 'none';
}

closePurchaseModalBtn.addEventListener('click', closePurchaseModal);
window.addEventListener('click', (event) => {
    if (event.target === purchaseModal) {
        closePurchaseModal();
    }
});

// In your skill rendering loop:
const skillEl = document.createElement('span');
skillEl.className = 'skill-entry';
// ... set content ...
if (price) {
    skillEl.addEventListener('click', () => openPurchaseModal(name, price));
}
```

## CSS Example (`/public/marketplace.css`)

```css
.modal-backdrop {
    position: fixed;
    inset: 0;
    background-color: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}
.modal-content {
    background: var(--panel, #14141c);
    padding: 24px;
    border-radius: 12px;
    border: 1px solid var(--border, #1f1f29);
    width: min(400px, 90vw);
}
.modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--border, #1f1f29);
    padding-bottom: 12px;
    margin-bottom: 12px;
}
.modal-header h2 { margin: 0; font-size: 18px; }
.modal-close-btn { background: none; border: none; color: #eee; font-size: 24px; cursor: pointer; }
.modal-footer { margin-top: 24px; text-align: right; }
.modal-action-btn {
    background-color: var(--accent, #6a5cff);
    color: white;
    /* ... other button styles */
}
```
