# Prompt 3: Implement Purchase Flow UI Modal

## Objective
Create a modal dialog that appears when a user clicks the "Unlock" button for a paid skill, presenting the details of the purchase and asking for confirmation.

## Explanation
A modal is a standard and effective way to handle a confirmation flow without navigating the user away from the current page. This modal will serve as the main interface for the skill purchase process, containing all necessary information for the user to make a decision.

## Instructions
1.  **Create Modal HTML:**
    *   In `marketplace.html`, add the HTML structure for a hidden modal.
    *   The modal should include a title, a section to display the skill name and price, a "Confirm Purchase" button, and a "Cancel" button or close icon.

2.  **Implement Modal Logic (`src/marketplace.js`):**
    *   Create functions to `showModal()` and `hideModal()`.
    *   Modify the event listener for the `.purchase-btn` clicks.
    *   When a purchase button is clicked, extract the skill name and price from the agent data.
    *   Populate the modal with the specific skill's details.
    *   Call `showModal()` to display it.
    *   Add event listeners to the "Cancel" and "Confirm Purchase" buttons within the modal.

## Code Example (HTML - `marketplace.html`)
```html
<!-- Add this inside the <body> tag -->
<div id="purchase-modal" class="modal-hidden">
  <div class="modal-content">
    <span class="close-button">&times;</span>
    <h2>Unlock Skill</h2>
    <p>You are about to purchase:</p>
    <p><strong>Skill:</strong> <span id="modal-skill-name"></span></p>
    <p><strong>Price:</strong> <span id="modal-skill-price"></span></p>
    <button id="modal-confirm-purchase">Confirm Purchase</button>
  </div>
</div>
```

## Code Example (JavaScript - `src/marketplace.js`)
```javascript
// Add event listener for purchase buttons (delegated)
document.addEventListener('click', (e) => {
    if (e.target.matches('.purchase-btn')) {
        const skillName = e.target.dataset.skillName;
        const agent = getCurrentAgentData(); // Assume this function gets the current agent's full data
        const price = agent.skill_prices[skillName];
        
        // Populate and show the modal
        document.getElementById('modal-skill-name').textContent = skillName;
        document.getElementById('modal-skill-price').textContent = `${(price.amount / 1e6).toFixed(2)} USDC`;
        document.getElementById('purchase-modal').classList.remove('modal-hidden');
    }
});

// Logic to hide modal
document.querySelector('.close-button').addEventListener('click', () => {
    document.getElementById('purchase-modal').classList.add('modal-hidden');
});
```

## CSS Example (`/marketplace.css`)
```css
.modal-hidden { display: none; }
/* Add styles for modal backdrop, content, etc. */
```
