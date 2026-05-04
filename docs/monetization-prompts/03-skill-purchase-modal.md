# Prompt 03: Create Skill Purchase Modal

## Objective
Create a modal that appears when a user clicks the "Purchase" button, confirming the skill details and price before the transaction.

## Explanation
A confirmation modal prevents accidental purchases and provides a clear, focused step in the user journey. This modal will be the central point for initiating the wallet transaction.

## Instructions
1.  **Create the Modal HTML:**
    *   Add the HTML structure for a hidden modal to `marketplace.html`. It should include placeholders for the skill name, price, and agent name, along with "Confirm Purchase" and "Cancel" buttons.

2.  **Add JavaScript Logic (`src/marketplace.js`):**
    *   Create a new function, `openPurchaseModal(skillName, price, agentName)`. This function will populate the modal with the correct data and make it visible.
    *   Attach an event listener to the `d-skills` container that listens for clicks on `.purchase-btn`.
    *   When a purchase button is clicked, get the skill name from the `data-skill-name` attribute, find its price from the agent data, and call `openPurchaseModal`.
    *   Add event listeners for the "Confirm" and "Cancel" buttons within the modal. For now, they can just log to the console.

## HTML Example (in `marketplace.html`)

```html
<div id="purchase-modal" class="modal-hidden">
  <div class="modal-content">
    <h2>Confirm Purchase</h2>
    <p>Unlock the skill <strong id="modal-skill-name"></strong> for agent <strong id="modal-agent-name"></strong>?</p>
    <div class="modal-price">Price: <span id="modal-skill-price"></span></div>
    <div class="modal-actions">
      <button id="modal-cancel-btn">Cancel</button>
      <button id="modal-confirm-btn">Confirm Purchase</button>
    </div>
  </div>
</div>
```

## JavaScript Example (`src/marketplace.js`)

```javascript
// At the end of init function
const skillsContainer = document.getElementById('d-skills');
skillsContainer.addEventListener('click', (event) => {
    if (event.target.classList.contains('purchase-btn')) {
        const skillName = event.target.dataset.skillName;
        // Assume 'currentAgent' is available in a higher scope
        const price = currentAgent.skill_prices[skillName];
        if (price) {
            openPurchaseModal(skillName, price, currentAgent.name);
        }
    }
});

function openPurchaseModal(skillName, price, agentName) {
    document.getElementById('modal-skill-name').textContent = skillName;
    document.getElementById('modal-agent-name').textContent = agentName;
    const priceText = `${(price.amount / 1e6).toFixed(2)} USDC`;
    document.getElementById('modal-skill-price').textContent = priceText;
    document.getElementById('purchase-modal').classList.remove('modal-hidden');
}

// Add listeners for modal buttons to close it, etc.
```
