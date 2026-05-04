# Prompt 24: Implement Toast Notifications

## Objective
Integrate a simple, reusable toast notification system to provide users with clear, non-blocking feedback for actions like saving settings, successful payments, or errors.

## Explanation
Status messages next to buttons are good, but they can be missed. Toast notifications are small popups (usually in a corner of the screen) that provide timely feedback. They are a standard feature in modern web apps and greatly improve the user experience. We will create a simple, vanilla JS system for this.

## Instructions
1.  **Add HTML and CSS:**
    *   In your main layout/HTML files (e.g., `marketplace.html`, `pump-dashboard.html`), add a container element for toasts. It should be fixed to a corner of the viewport.
    *   Add CSS to style the container and the individual toast messages. Toasts should have different styles for success, error, and info.

2.  **Create a JavaScript Helper:**
    *   In a shared JavaScript file (or create a new one like `src/ui-helpers.js`), write a function like `showToast(message, type = 'info', duration = 3000)`.
    *   The function should:
        *   Create a new `div` element for the toast.
        *   Add the `message` text to it.
        *   Add a class based on the `type` (e.g., `toast-success`, `toast-error`).
        *   Append the new toast to the toast container element.
        *   Use a `setTimeout` to automatically remove the toast element after the `duration`.
        *   Consider adding an animation for the toast appearing and disappearing.

3.  **Integrate with Existing Logic:**
    *   Go through the feature code you've already written and replace or augment `status.textContent` messages with calls to your new `showToast` function.
    *   **Payment Flow (`marketplace.js`):**
        *   Show a success toast: `showToast('Payment successful! Skill unlocked.', 'success')`.
        *   Show an error toast: `showToast(\`Error: ${error.message}\`, 'error')`.
    *   **Payout Settings (`dashboard.js`):**
        *   `showToast('Payout wallet saved.', 'success')`.
        *   `showToast('Withdrawal request submitted.', 'success')`.

## Code Example (HTML & CSS)

Add to a main HTML file (e.g., `marketplace.html`):
```html
<!-- At the end of <body> -->
<div id="toast-container"></div>
```

Add to a main CSS file (e.g., `style.css`):
```css
#toast-container {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.toast {
    padding: 12px 16px;
    border-radius: 6px;
    color: #fff;
    font-size: 14px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    animation: toast-in 0.3s ease;
    opacity: 0.95;
}

.toast.toast-info {
    background-color: #374151;
}
.toast.toast-success {
    background-color: #059669;
}
.toast.toast-error {
    background-color: #b91c1c;
}

@keyframes toast-in {
    from {
        transform: translateX(100%);
        opacity: 0;
    }
    to {
        transform: translateX(0);
        opacity: 0.95;
    }
}
```

## Code Example (JavaScript Helper)

```javascript
// In a new file src/ui-helpers.js or similar
function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, duration);
}

// In marketplace.js, after a successful payment:
// showToast('Payment successful! Skill unlocked.', 'success');
```
Make sure to import/include this helper function where you need it.
