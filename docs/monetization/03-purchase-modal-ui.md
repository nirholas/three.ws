---
status: not-started
---

# Prompt 3: Purchase Modal UI

## Objective
Create a reusable modal component for the skill purchase flow, which will serve as the container for payment steps.

## Explanation
When a user clicks the "Purchase" button, we shouldn't immediately trigger a wallet transaction. Instead, we should present them with a clear, focused modal window that confirms their intent and guides them through the payment process. This modal will initially show the skill details and price, and will later host the wallet connection and payment confirmation steps.

## Instructions
- [ ] **Create the Modal HTML Structure:**
  - [ ] Add a generic modal structure to `marketplace.html`. It should be hidden by default (`display: none`).
  - [ ] The modal should have a backdrop, a main content area, a title, a close button, and a section for dynamic content.

- [ ] **Create the Modal CSS:**
  - [ ] In `marketplace.css`, add styles for the modal, backdrop, and content area.
  - [ ] Ensure it's centered, has a reasonable size, and is styled consistently with the rest of the application.

- [ ] **Implement Modal Logic:**
  - [ ] In `src/marketplace.js`, add functions to `showModal(title, content)` and `hideModal()`.
  - [ ] `showModal` should populate the modal's title and content sections and make it visible.
  - [ ] `hideModal` should hide the modal. The close button and backdrop should trigger this function.
  - [ ] Add an event listener to the `d-skills` container that listens for clicks on `.purchase-btn` buttons.
  - [ ] When a purchase button is clicked, get the skill name from the `data-skill-name` attribute, then call `showModal` with the appropriate details to confirm the purchase.

## HTML Example (`marketplace.html`)

```html
<!-- Add this somewhere in your main container -->
<div id="purchase-modal" class="modal-backdrop" style="display: none;">
  <div class="modal-content">
    <div class="modal-header">
      <h2 id="modal-title"></h2>
      <button id="modal-close" class="modal-close-btn">&times;</button>
    </div>
    <div id="modal-body"></div>
  </div>
</div>
```

## JavaScript Example (`src/marketplace.js`)

```javascript
// Function to show the modal
function showModal(title, content) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = content;
    $('purchase-modal').style.display = 'flex';
}

// Function to hide the modal
function hideModal() {
    $('purchase-modal').style.display = 'none';
}

// Event listener for closing the modal
$('modal-close').addEventListener('click', hideModal);
$('purchase-modal').addEventListener('click', (e) => {
    if (e.target.id === 'purchase-modal') {
        hideModal();
    }
});

// Event listener for the purchase buttons
$('d-skills').addEventListener('click', (e) => {
    if (e.target.classList.contains('purchase-btn')) {
        const skillName = e.target.dataset.skillName;
        // Find the agent and skill details to show in the modal
        // For now, a simple confirmation:
        showModal(
            `Purchase Skill: ${skillName}`,
            `<p>You are about to purchase the skill "${skillName}".</p>
             <button id="confirm-purchase-btn">Confirm</button>`
        );
    }
});
```
