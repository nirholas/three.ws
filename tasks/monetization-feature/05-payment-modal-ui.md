# Prompt 5: Payment Modal UI

## Objective
Create the HTML structure and CSS styling for a reusable payment modal that will guide the user through the skill purchase process.

## Explanation
A modal is a focused UI element that overlays the page, perfect for multi-step processes like payments. We need a clean, clear modal that can display the item being purchased, connect to a wallet, show the price, and provide clear action buttons. For now, we will just build the static UI components. The logic will be wired up in subsequent prompts.

## Instructions
1.  **Add HTML to `marketplace.html`:**
    *   At the bottom of the `<body>` in `marketplace.html`, add the HTML for the modal overlay and the modal itself.
    *   The modal should be hidden by default (`hidden` attribute or `display: none`).
    *   Include sections for:
        *   A title (e.g., "Unlock Skill").
        *   A close button.
        *   The skill name and agent name.
        *   The price.
        *   A placeholder for wallet connection status.
        *   A primary action button (e.g., "Pay Now").
        *   A footer for status messages.

2.  **Add CSS to `marketplace.css`:**
    *   Create styles for the modal overlay to cover the screen with a semi-transparent background.
    *   Style the modal container itself: centered, with a border, background, and rounded corners.
    *   Style the internal elements: title, price display, buttons, etc.
    *   Use flexbox or grid for layout.

## Code Example (HTML - add to `marketplace.html`)

```html
<!-- At the end of the <body>, after the submit modal -->

<!-- Payment Modal -->
<div class="market-modal-overlay" id="payment-modal-overlay" hidden aria-modal="true" role="dialog" aria-labelledby="payment-modal-title">
    <div class="market-modal">
        <div class="market-modal-head">
            <h2 id="payment-modal-title">Unlock Skill</h2>
            <button class="market-modal-close" id="payment-modal-close" aria-label="Close">×</button>
        </div>
        <div class="payment-modal-body">
            <p>You are purchasing access to the following skill:</p>
            <div class="payment-item">
                <strong id="payment-skill-name"></strong>
                <span>from agent</span>
                <em id="payment-agent-name"></em>
            </div>

            <div class="payment-price">
                <span>Total</span>
                <strong id="payment-price-display"></strong>
            </div>

            <div class="payment-wallet-area" id="payment-wallet-area">
                <!-- Wallet connection status and button will be rendered here by JS -->
                <button class="btn-primary" id="payment-connect-wallet-btn">Connect Wallet</button>
            </div>
            
            <button class="btn-primary payment-confirm-btn" id="payment-confirm-btn" disabled>Confirm Purchase</button>

            <div class="payment-status" id="payment-status" role="status" aria-live="polite"></div>
        </div>
    </div>
</div>
```

## Code Example (CSS - add to `marketplace.css`)

```css
/* Payment Modal Styles */
.payment-modal-body {
    padding: 16px;
    font-size: 14px;
    color: rgba(255, 255, 255, 0.7);
}

.payment-item {
    background-color: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 12px;
    margin: 16px 0;
    text-align: center;
}

#payment-skill-name {
    display: block;
    font-size: 16px;
    font-weight: 600;
    color: #fff;
}

.payment-item > span {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
}

#payment-agent-name {
    display: block;
    font-size: 12px;
    font-style: normal;
}

.payment-price {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 12px 0;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

#payment-price-display {
    font-size: 20px;
    font-weight: 700;
    color: #fde047;
}

.payment-wallet-area {
    margin: 20px 0;
    padding: 16px;
    background-color: rgba(0, 0, 0, 0.2);
    border-radius: 8px;
    text-align: center;
}

.payment-confirm-btn {
    width: 100%;
    padding: 12px;
    font-size: 16px;
}

.payment-status {
    margin-top: 16px;
    font-size: 12px;
    text-align: center;
    min-height: 1.2em;
}
```
