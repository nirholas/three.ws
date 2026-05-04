# Prompt 14: UI Update After Successful Purchase

## Objective
After a skill purchase is successfully confirmed, dynamically update the agent detail UI to reflect the user's new ownership status without requiring a page reload.

## Explanation
A seamless user experience requires immediate feedback. Once the frontend polling (from Prompt 09) confirms a successful purchase, the UI should change instantly. The "Buy" button for the skill should be replaced with an "Owned" indicator, and any related UI elements should be updated.

## Instructions
1.  **Identify the Skill Element:**
    *   Ensure the HTML element for each skill in the list has a unique and predictable ID or class that includes the skill name, e.g., `<span class="skill-entry" id="skill-entry-weather-forecast">...</span>`.

2.  **Modify the Polling Success Callback:**
    *   In `src/marketplace.js`, locate the success block within the purchase confirmation polling loop (`if (status === 'confirmed')`).
    *   When a purchase is confirmed, you will have the `agentId` and `skillId`.
    *   **Find the UI Element:** Use the `skillId` to select the specific skill's UI element in the DOM.
    *   **Replace the Button:** Find the "Buy" button within that element and replace it with the "Owned" badge HTML.
    *   For example: `<span class="badge owned">✓ Owned</span>`.

3.  **Show a Success Notification:**
    *   Use a toast notification or a simple alert to explicitly tell the user their purchase was successful and they can now use the skill.

## Code Example (`src/marketplace.js`)

```javascript
// In the polling success callback, you have access to the skillId.
// Let's assume you stored it from when the "Buy" button was clicked.
const currentSkillId = 'weather-forecast'; // The skill being purchased

function onPurchaseSuccess(skillId) {
    // 1. Hide the modal and stop polling (already done).
    
    // 2. Find the skill entry in the DOM.
    const skillEntry = document.getElementById(`skill-entry-${skillId}`);
    if (!skillEntry) return;

    // 3. Find the buy button within it.
    const buyButton = skillEntry.querySelector('.btn-buy');
    
    // 4. Create and insert the "Owned" badge.
    const ownedBadge = document.createElement('span');
    ownedBadge.className = 'badge owned';
    ownedBadge.innerHTML = '✓ Owned';
    
    if (buyButton) {
        buyButton.replaceWith(ownedBadge);
    }
    
    // 5. Show a success notification.
    showToast('Purchase successful! You can now use the skill.');
}

// Inside the polling loop:
if (status === 'confirmed') {
    clearInterval(pollingId);
    $('purchase-modal').hidden = true;
    onPurchaseSuccess(currentSkillId);
}
```
