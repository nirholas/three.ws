# Prompt 13: Allow Creators to List Skills for Free

**Status:** - [ ] Not Started

## Objective
Enhance the skill monetization interface to allow creators to explicitly list a skill as "Free" or remove its price, making it available to all users without a purchase.

## Explanation
Not all skills should require payment. Creators may want to offer some skills for free as a preview or for community-building. The system needs to support toggling a skill between a paid and free state.

## Instructions
1.  **Update the UI for Price Management:**
    *   In the "Skill Monetization" section of `agent-edit.html`, for each skill, add a "Make Free" or "Remove Price" button next to the pricing inputs.
    *   If a skill currently has a price, this button should be active. If it's already free, the button can be disabled or hidden.
    *   The UI should visually indicate that a skill is free (e.g., by displaying "Free" instead of price inputs).

2.  **Create a Backend Endpoint for Removing Prices:**
    *   Create a new API endpoint, e.g., `api/agents/remove-skill-price.js`.
    *   This endpoint must be authenticated and verify that the user is the agent's creator.
    *   It should accept `agentId` and `skillName`.
    *   The handler will `DELETE` the corresponding record from the `agent_skill_prices` table.

3.  **Connect Frontend to Backend:**
    *   In the JavaScript for the agent edit page, add an event listener for the "Remove Price" button.
    *   When clicked, it should call the new `DELETE` endpoint.
    *   On success, update the UI for that skill to show it as free and clear the price input fields.

## Code Example (JavaScript for `agent-edit.html`)

```javascript
// Inside the event listener for the skill pricing list
$('skill-pricing-list').addEventListener('click', async (e) => {
  // ... (handle 'set-price-btn' clicks)

  if (e.target.classList.contains('remove-price-btn')) {
    const skillName = e.target.dataset.skillName;
    
    // Optional: Ask for confirmation
    if (!confirm(`Are you sure you want to make the skill "${skillName}" free?`)) {
      return;
    }

    const response = await fetch('/api/agents/remove-skill-price', {
      method: 'POST', // Or DELETE, depending on your API design
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: currentAgentId,
        skillName,
      }),
    });

    if (response.ok) {
      showToast('Skill is now free!', 'success');
      // Re-render the pricing section to reflect the change
      // Or dynamically update the specific row
      const priceInput = document.querySelector(`input[data-skill-name="${skillName}"]`);
      priceInput.value = '';
    } else {
      showToast('Failed to update skill.', 'error');
    }
  }
});
```

## Code Example (Backend - `api/agents/remove-skill-price.js`)

```javascript
import { getDB } from './_lib/db';

export default async function handler(req, res) {
  // Assume user is authenticated and is the agent owner
  const { agentId, skillName } = req.body;

  const db = getDB();
  try {
    await db.query(
      'DELETE FROM agent_skill_prices WHERE agent_id = $1 AND skill_name = $2',
      [agentId, skillName]
    );
    res.status(200).json({ success: true, message: 'Skill price removed.' });
  } catch (error) {
    console.error('Failed to remove skill price:', error);
    res.status(500).json({ error: 'Failed to update skill.' });
  }
}
```
