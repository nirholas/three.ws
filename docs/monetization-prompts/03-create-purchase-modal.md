# Prompt 3: Create Purchase Confirmation Modal

**Status:** - [ ] Not Started

## Objective
Implement a modal dialog that appears when a user clicks the "Purchase" button for a skill, asking for confirmation before proceeding with the transaction.

## Explanation
A confirmation step is crucial for any purchasing flow to prevent accidental purchases. This modal will summarize the transaction (skill name, price) and require an explicit user action to continue. It will serve as the container for wallet interactions in subsequent steps.

## Instructions
1.  **Create Modal HTML Structure:**
    *   Add the HTML for a modal to `marketplace.html`. It should be hidden by default.
    *   The modal should contain elements for the skill name, price, a "Confirm Purchase" button, and a close button.

2.  **Add JavaScript Logic to Control the Modal:**
    *   In `src/marketplace.js`, add event listeners for the "Purchase" buttons. Since these buttons are dynamically generated, use event delegation on a parent element (e.g., `$('d-skills')`).
    *   When a purchase button is clicked, populate the modal with the correct skill name and price.
    *   Show the modal.
    *   Implement the logic for the close button and for closing the modal by clicking the backdrop.

3.  **Style the Modal:**
    *   Add CSS to `/marketplace.css` to style the modal, its backdrop, and its contents for a clean, user-friendly appearance.

## Code Example (HTML in `marketplace.html`)

```html
<!-- Add this somewhere in the body of marketplace.html -->
<div id="purchase-modal-backdrop" class="modal-backdrop" style="display: none;">
  <div id="purchase-modal" class="modal">
    <div class="modal-header">
      <h2>Confirm Purchase</h2>
      <button id="modal-close-btn" class="modal-close-btn">&times;</button>
    </div>
    <div class="modal-body">
      <p>You are about to purchase the skill:</p>
      <h3 id="modal-skill-name"></h3>
      <p>Price:</p>
      <h3 id="modal-skill-price"></h3>
    </div>
    <div class="modal-footer">
      <button id="modal-confirm-purchase-btn" class="purchase-btn">Confirm Purchase</button>
    </div>
  </div>
</div>
```

## Code Example (JavaScript in `src/marketplace.js`)

```javascript
// At the top of the script
const purchaseModal = $('purchase-modal-backdrop');
const modalSkillName = $('modal-skill-name');
const modalSkillPrice = $('modal-skill-price');

// Event listener using delegation
$('d-skills').addEventListener('click', (e) => {
  if (e.target.classList.contains('purchase-btn')) {
    const skillName = e.target.dataset.skillName;
    const agent = window.currentAgent; // Assuming current agent data is available
    const priceInfo = agent.skill_prices[skillName];
    
    if (priceInfo) {
      modalSkillName.textContent = skillName;
      modalSkillPrice.textContent = `${(priceInfo.amount / 1e6).toFixed(2)} USDC`;
      purchaseModal.style.display = 'flex';
    }
  }
});

// Close modal logic
$('modal-close-btn').addEventListener('click', () => {
  purchaseModal.style.display = 'none';
});
purchaseModal.addEventListener('click', (e) => {
  if (e.target === purchaseModal) {
    purchaseModal.style.display = 'none';
  }
});
```

## CSS Example (`/marketplace.css`)

```css
.modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal {
  background-color: var(--panel);
  padding: 24px;
  border-radius: 12px;
  border: 1px solid var(--border);
  width: 90%;
  max-width: 400px;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border);
  padding-bottom: 16px;
  margin-bottom: 16px;
}

.modal-header h2 {
  margin: 0;
  font-size: 18px;
}

.modal-close-btn {
  background: none;
  border: none;
  font-size: 24px;
  color: var(--muted);
  cursor: pointer;
}
```
