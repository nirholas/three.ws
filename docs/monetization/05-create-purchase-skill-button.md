# Prompt 5: Create "Purchase Skill" Button

## Status
- [ ] Not Started

## Objective
Add a "Purchase" button for priced skills on the agent detail page and a modal to confirm the purchase.

## Explanation
With the front-end now able to display skill prices, the next step is to provide users with a clear call-to-action to initiate a purchase. This prompt covers adding the button and a confirmation modal.

## Instructions
1.  **Modify the Skill Rendering Logic:**
    *   In `src/marketplace.js` within the `renderDetail` function, update the skill rendering logic.
    *   For skills that have a price, instead of just a badge, render a "Purchase" button.
    *   The button should include `data-` attributes to store the skill name, price, and currency mint, which will be needed to initiate the transaction.

2.  **Create a Purchase Confirmation Modal:**
    *   Add a hidden modal to your main HTML (`app.html` or `marketplace.html`).
    *   The modal should display the details of the skill being purchased (name, price) and include "Confirm" and "Cancel" buttons.

3.  **Implement Button Logic:**
    *   Add a click event listener to the "Purchase" buttons.
    *   When a button is clicked, read the `data-` attributes and populate the confirmation modal with the correct information, then display the modal.

## Code Example (Frontend - `src/marketplace.js`)
```javascript
// Inside renderDetail function
const skillPrices = a.skill_prices || {};
$('d-skills').innerHTML = skillsArr.length
    ? skillsArr.map((s) => {
        const name = typeof s === 'string' ? s : (s.name || '');
        const price = skillPrices[name];
        let actionElement;
        if (price) {
            const priceDisplay = `${(price.amount / 1e6).toFixed(2)} USDC`;
            actionElement = `<button class="purchase-skill-btn" 
                                data-skill-name="${escapeHtml(name)}"
                                data-price-amount="${price.amount}"
                                data-currency-mint="${price.currency_mint}">
                                Purchase for ${priceDisplay}
                             </button>`;
        } else {
            actionElement = `<span class="price-badge price-free">Free</span>`;
        }
        return `<div class="skill-entry">
                  <span>${escapeHtml(name)}</span>
                  ${actionElement}
                </div>`;
    }).join('')
    : '<div>This Agent has no skills defined.</div>';

// Add event listeners after rendering
document.querySelectorAll('.purchase-skill-btn').forEach(button => {
    button.addEventListener('click', handlePurchaseClick);
});
```

## Code Example (HTML for Modal)
```html
<!-- Add to app.html or marketplace.html -->
<div id="purchase-confirm-modal" class="modal-hidden">
  <div class="modal-content">
    <h2>Confirm Purchase</h2>
    <p>You are about to purchase the skill: <b id="modal-skill-name"></b></p>
    <p>Price: <b id="modal-skill-price"></b></p>
    <div class="modal-actions">
      <button id="modal-confirm-btn">Confirm</button>
      <button id="modal-cancel-btn">Cancel</button>
    </div>
  </div>
</div>
```

## Code Example (Event Handling)
```javascript
function handlePurchaseClick(event) {
  const button = event.currentTarget;
  const skillName = button.dataset.skillName;
  const priceAmount = button.dataset.priceAmount;
  const currencyMint = button.dataset.currencyMint;

  // Populate and show the modal
  document.getElementById('modal-skill-name').textContent = skillName;
  document.getElementById('modal-skill-price').textContent = `${(priceAmount / 1e6).toFixed(2)} USDC`;
  document.getElementById('purchase-confirm-modal').classList.remove('modal-hidden');
  
  // Store data for the transaction
  document.getElementById('modal-confirm-btn').dataset.skillData = JSON.stringify({
      skillName, priceAmount, currencyMint
  });
}

// Add event listener for the cancel button to hide the modal
document.getElementById('modal-cancel-btn').addEventListener('click', () => {
    document.getElementById('purchase-confirm-modal').classList.add('modal-hidden');
});
```
