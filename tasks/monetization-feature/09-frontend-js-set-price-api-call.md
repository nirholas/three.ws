---
status: not-started
---
# Prompt 9: Set Price API Call from Frontend

**Status:** Not Started

## Objective
Implement the frontend JavaScript logic to submit the new price from the modal to the backend API.

## Explanation
This task connects the UI created in the previous step to the backend API for setting prices. It involves handling the form submission, calling the API with the correct data, and providing feedback to the user based on the response.

## Instructions
- **In `src/creator-dashboard.js`, add a `submit` event listener to the `#price-form` in the modal.**
- **Inside the submit handler:**
    1.  Prevent the default form submission.
    2.  Retrieve the `skill_id`, `amount`, and `currency_mint` from the form inputs.
    3.  **Important:** Convert the human-readable amount (e.g., 1.50 USDC) to the smallest unit required by the backend (e.g., 1,500,000 lamports). This might involve multiplying by `1e6` for USDC.
    4.  Call the `POST /api/skills/:skill_id/price` endpoint using `fetch`.
    5.  Include the data in the request body as JSON.
    6.  Handle the response:
        - On success, close the modal and show a confirmation message. Maybe update the UI to show the new price.
        - On failure, display an error message to the user.

## Code Example (Frontend - `src/creator-dashboard.js`)
```javascript
document.getElementById('price-form').addEventListener('submit', async (event) => {
    event.preventDefault();

    const skillId = document.getElementById('modal-skill-id').value;
    const amountInput = document.getElementById('price-amount').value;
    const currency = document.getElementById('price-currency').value;
    
    // Convert to smallest unit (e.g., lamports for USDC)
    const amountInSmallestUnit = parseFloat(amountInput) * 1e6;

    try {
        const response = await fetch(`/api/skills/${skillId}/price`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: amountInSmallestUnit,
                currency_mint: currency,
            }),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to set price.');
        }

        // Success
        alert('Price updated successfully!');
        document.getElementById('price-modal').hidden = true;
        fetchMySkills(); // Refresh the list to show new price

    } catch (error) {
        alert(`Error: ${error.message}`);
    }
});
```
