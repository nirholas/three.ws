# Prompt 6: Trigger Payment Modal

## Objective
Wire up the "Purchase" buttons on the agent detail page to open the payment modal and pre-fill it with the correct skill and price information by fetching a payment intent from the backend.

## Explanation
With the modal UI and the payment intent API in place, we can now connect them. When a user clicks "Purchase" on a specific skill, the frontend should:
1.  Prevent any default action.
2.  Call the `/api/payments/intent` endpoint with the agent ID and skill name.
3.  Use the response to populate the payment modal's UI.
4.  Display the modal to the user.

## Instructions
1.  **Add Event Listener:**
    *   In `src/marketplace.js`, modify the `renderDetail` function.
    *   After rendering the skills, add a single event listener to the `d-skills` container. Use event delegation to catch clicks on `.purchase` buttons. This is more efficient than adding a listener to every button.

2.  **Implement the Click Handler:**
    *   The handler function should be `async`.
    *   Get the `skill-name` from the button's `data-skill-name` attribute.
    *   Show a loading state (e.g., disable the button, change its text).
    *   `POST` to `/api/payments/intent` with the current agent's ID (`detailState.agent.id`) and the skill name. Remember to include credentials.

3.  **Populate and Show the Modal:**
    *   On a successful API response, grab the modal elements.
    *   Populate the skill name, agent name, and price fields using the data from the payment intent. Format the price correctly.
    *   Store the `intent_id` and other relevant data from the response in a variable or on a DOM element for the next step (payment).
    *   Remove the `hidden` attribute from the modal overlay to show it.
    *   Reset the loading state of the purchase button.

4.  **Handle Modal Closing:**
    *   Add event listeners to the modal's close button and overlay to hide the modal when clicked.

## Code Example (Frontend - `src/marketplace.js`)

```javascript
// Add this new function to marketplace.js

function bindPurchaseFlow() {
    const skillsContainer = $('d-skills');
    if (!skillsContainer) return;

    skillsContainer.addEventListener('click', async (e) => {
        if (!e.target.matches('.purchase')) return;

        const btn = e.target;
        const skillName = btn.dataset.skillName;
        if (!skillName || !detailState.agent) return;

        btn.disabled = true;
        btn.textContent = 'Preparing...';

        try {
            const res = await fetch('/api/payments/intent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    agent_id: detailState.agent.id,
                    skill_name: skillName,
                }),
            });
            const intent = await res.json();
            if (!res.ok) throw new Error(intent.error_description || 'Failed to create payment intent.');
            
            openPaymentModal(intent, skillName);

        } catch (err) {
            console.error('Payment intent failed', err);
            // You could show a toast notification here
        } finally {
            btn.disabled = false;
            btn.textContent = 'Purchase';
        }
    });
}

function openPaymentModal(intent, skillName) {
    // Store intent for later use
    document.getElementById('payment-modal-overlay').dataset.intentId = intent.intent_id;

    // Populate modal
    $('payment-skill-name').textContent = skillName;
    $('payment-agent-name').textContent = detailState.agent.name;
    const priceInUSDC = (Number(intent.amount) / 1e6).toFixed(2);
    $('payment-price-display').textContent = `${priceInUSDC} USDC`;

    // Show modal
    $('payment-modal-overlay').hidden = false;
}

function closePaymentModal() {
    $('payment-modal-overlay').hidden = true;
}


// --- Inside the init() or similar setup function ---
// Call bindPurchaseFlow whenever the detail view is shown
// For example, inside loadDetail after rendering:
// renderDetail(a, aJ.data.bookmarked);
// bindPurchaseFlow();

// Add listeners for closing the modal
$('payment-modal-close').addEventListener('click', closePaymentModal);
$('payment-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'payment-modal-overlay') {
        closePaymentModal();
    }
});
```

**Note:** You will need to call `bindPurchaseFlow()` at the appropriate time, likely after the detail view has been rendered by the `loadDetail` function, to ensure the buttons exist in the DOM.
