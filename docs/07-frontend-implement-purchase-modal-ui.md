# Prompt 7: Frontend - Implement Skill Purchase Modal UI

## Objective
Build the HTML and CSS for the skill purchase modal based on the design defined in the previous prompt.

## Explanation
With the UI/UX design for the purchase modal complete, we can now translate it into a functional frontend component. This task focuses on building the structure and styling of the modal, without yet wiring it up to the Solana Pay logic. This separation of concerns allows us to perfect the visual presentation first.

## Instructions
1.  **Add Modal HTML to `marketplace.html`:**
    *   Add the HTML structure for a modal to the bottom of your `marketplace.html` file. It should be hidden by default (e.g., with `display: none`).
    *   Use clear and semantic element IDs for the dynamic parts of the modal (e.g., `purchase-modal-skill-name`, `purchase-modal-price`, `purchase-modal-cta`).

2.  **Create CSS for the Modal:**
    *   In `/public/marketplace.css`, add styles for the modal container, backdrop, header, content, and buttons.
    *   Ensure the modal is centered, has a professional appearance, and is responsive to different screen sizes.

3.  **Add JavaScript to Show/Hide the Modal:**
    *   In `src/marketplace.js`, add a function to populate and show the modal when a paid skill is clicked.
    *   Add event listeners for the close button and backdrop to hide the modal.

## Code Example (HTML in `marketplace.html`)

```html
<!-- Add at the end of the body -->
<div id="purchase-modal-backdrop" class="modal-backdrop" style="display: none;">
  <div id="purchase-modal" class="modal">
    <div class="modal-header">
      <h2 id="purchase-modal-title">Purchase Skill</h2>
      <button id="purchase-modal-close" class="modal-close-btn">&times;</button>
    </div>
    <div class="modal-body">
      <p id="purchase-modal-description"></p>
      <div class="creator-info">Created by: <span id="purchase-modal-creator"></span></div>
      <hr />
      <div class="price-details">
        <span>Price:</span>
        <strong id="purchase-modal-price"></strong>
      </div>
      <div class="status-area" id="purchase-modal-status"></div>
    </div>
    <div class="modal-footer">
      <button id="purchase-modal-cta" class="cta-button">Purchase</button>
    </div>
  </div>
</div>
```

## Code Example (JavaScript in `src/marketplace.js`)

```javascript
// Function to open the modal
function showPurchaseModal(skillName, price, description, creator) {
  $('purchase-modal-title').textContent = `Purchase Skill: ${skillName}`;
  $('purchase-modal-description').textContent = description;
  $('purchase-modal-creator').textContent = creator;
  $('purchase-modal-price').textContent = `${(price.amount / 1e6).toFixed(2)} USDC`;

  // Store data for the purchase action
  const cta = $('purchase-modal-cta');
  cta.dataset.skillName = skillName;
  cta.dataset.amount = price.amount;
  cta.dataset.mint = price.currency_mint;

  $('purchase-modal-backdrop').style.display = 'flex';
}

// Add event listeners for showing/hiding
document.addEventListener('DOMContentLoaded', () => {
    // Hide modal logic
    const backdrop = $('purchase-modal-backdrop');
    $('purchase-modal-close').addEventListener('click', () => backdrop.style.display = 'none');
    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
            backdrop.style.display = 'none';
        }
    });

    // Show modal logic (example, needs to be integrated with skill list rendering)
    $('d-skills').addEventListener('click', (e) => {
        const skillEntry = e.target.closest('.skill-entry.paid'); // Add .paid class to priced skills
        if (skillEntry) {
            // Fetch skill details from data attributes or an in-memory object
            // showPurchaseModal(skillName, price, ...);
        }
    });
});
```
