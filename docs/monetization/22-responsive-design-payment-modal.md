# Prompt 22: Responsive Design for Payment Modal

## Objective
Ensure the Solana Pay QR code modal and related monetization UI elements are fully responsive and usable on all screen sizes, especially mobile devices.

## Explanation
A significant portion of users, especially in the web3 space, may interact with the platform on mobile devices. The payment flow, in particular, is centered around mobile wallets. Therefore, the QR code must be easy to scan and the surrounding information must be legible on small screens.

## Instructions
1.  **Use CSS Media Queries:**
    *   In your `marketplace.css` file, add `@media` queries to adjust the styling of the payment modal for smaller screens.

2.  **Adjust Modal Size:**
    *   On mobile, the modal should likely take up the full width and a larger portion of the height of the screen to maximize space for the QR code.
    *   `width: 95vw; max-width: 400px;` is a common pattern.

3.  **Optimize QR Code Size:**
    *   The QR code itself needs to be large enough to be easily scannable. You might need to adjust the `size` parameter passed to `createQR` based on the screen width, or simply use a larger default size that also works on desktop.

4.  **Layout Changes:**
    *   Consider changing the layout of elements inside the modal on small screens. For example, a two-column layout on desktop might need to stack into a single column on mobile. Use flexbox properties like `flex-direction: column;`.

5.  **Test Thoroughly:**
    *   Use your browser's developer tools to simulate various mobile device screen sizes (e.g., iPhone, Android devices) and test the entire purchase flow.

## CSS Example (`marketplace.css`)

```css
/* Base styles for the payment modal */
#payment-modal {
    width: 450px;
    padding: 24px;
    border-radius: 12px;
    /* ... other styles */
}

.qr-code-container {
    width: 300px; /* default size */
    height: 300px;
    margin: 20px auto;
}


/* Media query for mobile devices */
@media (max-width: 600px) {
    #payment-modal {
        width: 90vw; /* Take up most of the screen width */
        padding: 16px;
    }

    .qr-code-container {
        width: 80vw; /* Make QR code responsive to screen width */
        height: 80vw;
        max-width: 280px;
        max-height: 280px;
    }

    #payment-modal h2 {
        font-size: 18px; /* Adjust font sizes for readability */
    }
}
```
