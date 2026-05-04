---
status: not-started
---

# Prompt 13: Frontend Logic to Save Skill Prices

**Status:** Not Started

## Objective
Implement the client-side JavaScript to handle saving the skill prices set by the agent creator.

## Explanation
When the user clicks the "Save Prices" button in the monetization tab, the frontend needs to collect the data from all the input fields and send it to the backend API endpoint created in Prompt 3.

## Instructions
- [ ] **Add an Event Listener:**
    - [ ] In the agent editor's JavaScript, add a `click` event listener to the "Save Prices" button (`#save-prices-btn`).
- [ ] **Data Collection:**
    - [ ] Inside the event listener, iterate through each `.skill-price-entry` element.
    - [ ] For each skill, read the `skill-name` from the `data-` attribute, the price from the `.price-input`, and the currency from the `.currency-input`.
    - [ ] Remember to convert the human-readable price (e.g., 1.50 USDC) back into the smallest unit (lamports, e.g., 1,500,000).
- [ ] **API Call:**
    - [ ] For each skill that has a price set, call the `POST /api/agents/prices` endpoint. You can do this in a loop or batch the requests.
    - [ ] The body of the request should be `{ agentId, skillName, amount, currencyMint }`.
- [ ] **Provide User Feedback:**
    - [ ] Show a success message (e.g., a toast notification) when the prices are saved successfully.
    - [ ] Display an error message if the API call fails.

## Code Example (JavaScript)

```javascript
// In the agent editor's JS file

document.addEventListener('click', async (e) => {
    if (e.target.id === 'save-prices-btn') {
        e.target.disabled = true;
        e.target.textContent = 'Saving...';

        const entries = document.querySelectorAll('.skill-price-entry');
        for (const entry of entries) {
            const skillName = entry.dataset.skillName;
            const amountUSD = parseFloat(entry.querySelector('.price-input').value);
            const currencyMint = entry.querySelector('.currency-input').value;
            const amountLamports = Math.round(amountUSD * 1e6); // Convert to lamports

            try {
                const response = await fetch('/api/agents/prices', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        agentId: currentAgent.id, // Assumes currentAgent is available in scope
                        skillName,
                        amount: amountLamports,
                        currencyMint,
                    }),
                });

                if (!response.ok) {
                    throw new Error('Failed to save price for ' + skillName);
                }
            } catch (err) {
                console.error(err);
                alert('Error saving prices. Check the console.');
                // Re-enable button and break
                e.target.disabled = false;
                e.target.textContent = 'Save Prices';
                return;
            }
        }

        e.target.disabled = false;
        e.target.textContent = 'Save Prices';
        alert('Prices saved successfully!');
    }
});
```
