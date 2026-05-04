# Prompt 21: Loading States (Frontend)

## Objective
Implement clear loading states throughout the marketplace and payment UI to provide feedback to the user during asynchronous operations.

## Explanation
A responsive UI should always inform the user when it's busy. Waiting for data to load or a process to complete without any visual feedback can make an application feel slow or broken. This task involves adding loading indicators (like spinners or skeleton screens) to all parts of the monetization feature that involve waiting.

## Instructions
1.  **Agent Detail Page:**
    *   When the agent detail page is loading its data (including skill prices), display a skeleton UI. This means showing grayed-out placeholder boxes where the agent name, description, and skills will eventually appear. This provides a better perceived performance than a blank screen or a single large spinner.

2.  **Payment Modal:**
    *   When the user clicks "Purchase" and the frontend is waiting for the backend to create the transaction, show a spinner in the center of the modal.
    *   The QR code and payment details should only appear after the API call is successful and the spinner is hidden.

3.  **Buttons:**
    *   Disable buttons and show a loading state on them while their associated action is in progress. For example, the "Save Prices" button on the agent edit page should be disabled and could show text like "Saving..." to prevent double-clicks.

## CSS for Skeleton Loader

```css
.skeleton {
  background-color: #2a2a36; /* A darker panel color */
  border-radius: 4px;
  animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  50% {
    opacity: .5;
  }
}

/* Example usage for a skill entry */
.skill-entry-skeleton {
    display: inline-block;
    width: 120px;
    height: 24px;
    margin: 4px;
}
```

## HTML/JS for Skeleton State

```javascript
// In src/marketplace.js, before fetching the agent data

function showDetailSkeleton() {
    $('d-skills').innerHTML = `
        <span class="skill-entry-skeleton skeleton"></span>
        <span class="skill-entry-skeleton skeleton"></span>
        <span class="skill-entry-skeleton skeleton"></span>
    `;
    // Also show skeletons for agent name, description, etc.
}

async function renderDetail(id) {
    showDetailSkeleton(); // Show skeleton first
    try {
        const agent = await fetchAgentData(id);
        // ... then render the actual data
    } catch (e) {
        // ... handle error
    }
}
```

## Button Loading State

```javascript
// In the save prices click handler
const saveBtn = document.getElementById('save-skill-prices-btn');
saveBtn.disabled = true;
saveBtn.textContent = 'Saving...';

try {
    await savePrices();
    showToast('Success!');
} catch (e) {
    showToast('Error!', 'error');
} finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Prices';
}
```
