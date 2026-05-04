---
status: not-started
---

# Prompt 7: UI - Create Purchase Modal

**Status:** Not Started

## Objective
Design and implement a modal dialog that appears when a user clicks the "Buy" button, presenting them with payment options.

## Explanation
A modal provides a focused, clean user experience for the payment process. This first version of the modal will be simple. It will confirm the skill being purchased and its price, and for now, it will present a Solana Pay QR code for the transaction. This separates the payment step from the main UI and prepares us for adding more payment methods later.

## Instructions
- [ ] **Add HTML for the modal to `marketplace.html`:**
    - [ ] Create a hidden `div` that will serve as the modal container.
    - [ ] Inside, add elements for a title, skill name, price, a container for a QR code, and a close button.
- [ ] **Add CSS for the modal in `marketplace.css`:**
    - [ ] Style the modal to overlay the page content with a dark backdrop.
    - [ ] Center the modal content and style the text and QR code container.
- [ ] **Add JavaScript logic in `src/marketplace.js`:**
    - [ ] Create a function `showPurchaseModal(agentId, skillName, price)`.
    - [ ] Attach a click event listener to the `d-skills` container that delegates to `.purchase-btn` clicks.
    - [ ] When a purchase button is clicked, call `showPurchaseModal` with the relevant data from the button's `data-` attributes.
    - [ ] The function will populate and display the modal.

## HTML Example (`marketplace.html`)
```html
<!-- Add this somewhere inside the <body> tag -->
<div id="purchaseModal" class="modal-hidden">
    <div class="modal-content">
        <span class="modal-close-btn">&times;</span>
        <h2>Purchase Skill</h2>
        <p>You are about to buy the skill:</p>
        <p id="modalSkillName" class="modal-skill-name"></p>
        <p>for</p>
        <p id="modalSkillPrice" class="modal-skill-price"></p>
        <div id="modalQrCode"></div>
        <p class="modal-hint">Scan with a Solana Pay compatible wallet.</p>
    </div>
</div>
```

## CSS Example (`marketplace.css`)
```css
.modal-hidden { display: none; }
#purchaseModal {
  position: fixed; z-index: 1000; left: 0; top: 0;
  width: 100%; height: 100%;
  background-color: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
}
.modal-content {
  background-color: #1a1a1a; color: #fff;
  padding: 2rem; border-radius: 8px;
  width: 90%; max-width: 400px;
  text-align: center;
  position: relative;
}
.modal-close-btn {
  position: absolute; top: 10px; right: 15px;
  font-size: 28px; font-weight: bold; cursor: pointer;
}
```

## Tracking
- To mark this task as complete, check all boxes in the instructions and change the status in the frontmatter to `Completed`.
