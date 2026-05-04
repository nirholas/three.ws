---
status: not-started
---

# Prompt 7: Purchase Skill UI

## Objective
Create the user interface elements for purchasing a skill, including a "Buy" button and a modal to display the payment QR code.

## Explanation
With the basic Solana Pay integration in place, we now need the UI that users will interact with. This involves replacing the price badge for unowned, paid skills with a "Buy" button and designing a modal window that will contain the payment instructions and QR code.

## Instructions
1.  **Update Skill Rendering Logic:**
    *   In the agent detail page's JavaScript, modify the skill rendering function.
    *   For a paid skill that the user has *not* yet purchased, instead of just a price badge, render a "Buy" button alongside the price.
    *   The button should have an event listener (e.g., `onclick`) that calls the `PurchaseFlow.initiatePurchase(agent, skillName)` function.
    *   You will need a (currently mock) function `userHasSkill(skillName)` to check ownership.

2.  **Create the Payment Modal HTML:**
    *   In `marketplace.html`, add the HTML structure for a modal dialog.
    *   It should be hidden by default (e.g., with `display: none`).
    *   The modal should include:
        *   A title, e.g., "Complete Your Purchase".
        *   A container element where the QR code will be rendered.
        *   An area to display information like the skill name and price.
        *   A "Cancel" or close button.

3.  **Style the Modal:**
    *   Add CSS to style the modal as an overlay with a centered content box, similar to other modals in the application.

4.  **Implement Modal Show/Hide Logic:**
    *   Create simple JavaScript functions `showPaymentModal()` and `hidePaymentModal()`.
    *   The `PurchaseFlow.displayPaymentQR` function will call `showPaymentModal()` once it's ready to display the QR code.
    *   The close button and overlay background should call `hidePaymentModal()`.

## Code Example (Updated Skill Rendering)

```javascript
// (Assuming a mock function `userHasSkill` for now)
const userUnlockedSkills = []; // Mock: will be populated with user data
function userHasSkill(skillName) {
  return userUnlockedSkills.includes(skillName);
}

// Inside agent detail rendering
const skillPrices = agent.skill_prices || {};
skillsElement.innerHTML = agent.skills.map(skill => {
  const name = skill.name || skill;
  const price = skillPrices[name];

  let badgeOrButton;
  if (price) {
    if (userHasSkill(name)) {
      badgeOrButton = `<span class="price-badge price-unlocked">✅ Purchased</span>`;
    } else {
      const priceStr = `${(price.amount / 1e6).toFixed(2)} USDC`;
      badgeOrButton = `<span class="price-badge price-paid">${priceStr}</span>
                       <button class="buy-button" onclick='PurchaseFlow.initiatePurchase(${JSON.stringify(agent)}, "${escapeJs(name)}")'>Buy</button>`;
    }
  } else {
    badgeOrButton = `<span class="price-badge price-free">Free</span>`;
  }
  return `<span class="skill-entry">${escapeHtml(name)}${badgeOrButton}</span>`;
}).join('');
```

## Code Example (HTML for Payment Modal)

```html
<!-- Add this somewhere in your marketplace.html body -->
<div id="payment-modal-backdrop" class="modal-backdrop">
  <div class="modal-content">
    <div class="modal-header">
      <h3>Complete Your Purchase</h3>
      <button id="payment-modal-close" class="close-button">&times;</button>
    </div>
    <div class="modal-body">
      <p>Scan the code with a Solana Pay compatible wallet to purchase:</p>
      <strong id="payment-skill-name"></strong> for <strong id="payment-skill-price"></strong>
      <div id="payment-qr-container">
        <!-- QR Code will be rendered here -->
      </div>
      <div class="spinner" id="payment-spinner"></div>
      <p class="status-text" id="payment-status-text">Waiting for payment...</p>
    </div>
  </div>
</div>
```

## CSS for Buy Button

```css
.buy-button {
  background-color: var(--accent);
  color: #000;
  border: none;
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  margin-left: 8px;
  vertical-align: middle;
}
.buy-button:hover {
  background-color: #00ff55;
}
```
