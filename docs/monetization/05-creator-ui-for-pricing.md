---
status: not-started
completed_at: null
---
# Prompt 5: Creator Dashboard UI for Pricing Skills

## Objective
Create a user interface in the Creator Dashboard that allows an agent creator to view their agent's skills and set prices for them.

## Explanation
To enable creators to monetize their work, they need a simple and intuitive interface. This task involves building a new section in the agent editing page of the Creator Dashboard. This section will list all of the agent's skills and provide input fields for creators to set a price for each one. The interface will use the API created in Prompt #3 to save these prices.

## Instructions
1.  **Locate the Creator Dashboard Page:**
    *   Find the HTML file for the agent editor in the Creator Dashboard (e.g., `agent-edit.html`).

2.  **Create the Skill Pricing Section:**
    *   Add a new section to the page titled "Skill Monetization" or "Skill Pricing".
    *   This section should only be visible to the agent's owner.
    *   Fetch the agent's details, including their list of skills and any existing `skill_prices`.

3.  **Render the Skill List:**
    *   Iterate through the agent's skills. For each skill, render:
        *   The skill name (read-only).
        *   An input field for the `amount`.
        *   A dropdown/select for the `currency_mint` (initially, this can be hardcoded to just show USDC, but it should be designed to be extensible).
        *   A "Save" or "Update" button for each skill.
        *   A "Make Free" or "Remove Price" button.

4.  **Implement the API Interaction:**
    *   When the creator clicks "Save", make a `POST` request to the `/api/creator/agents/:agentId/skills/price` endpoint.
    *   The request body should include the `skill_name`, `amount` (converted to the smallest unit), and `currency_mint`.
    *   When the "Make Free" button is clicked, make a similar `POST` request, but set the `amount` to `0` or `null`.
    *   Provide feedback to the user on success (e.g., a "Saved!" message) or failure (e.g., an error message).
    *   Use a debounce on the input fields to prevent excessive API calls if you choose to save on input change.

## UI Mockup Idea

```
+------------------------------------------------------+
| Skill Pricing                                        |
+------------------------------------------------------+
|                                                      |
|   translate           [ 1.00  ] [ USDC  ▼ ] [ Save ] |
|                                                      |
|   summarize-document  [ 0.00  ] [ USDC  ▼ ] [ Set Price ] |
|                                                      |
|   generate-image      [ 5.00  ] [ USDC  ▼ ] [ Save ] [ Make Free ] |
|                                                      |
+------------------------------------------------------+
```

## Code Example (Frontend JavaScript)

```javascript
// This is a conceptual example for the event handling

async function saveSkillPrice(agentId, skillName, amount, currency) {
  // Note: Convert amount to smallest unit, e.g., amount * 1e6 for USDC
  const amountInSmallestUnit = Math.round(parseFloat(amount) * 1e6);

  const response = await fetch(`/api/creator/agents/${agentId}/skills/price`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      skill_name: skillName,
      amount: amountInSmallestUnit,
      currency_mint: currency,
    }),
  });

  if (response.ok) {
    // Show success feedback
    console.log(`Price for ${skillName} saved successfully!`);
  } else {
    // Show error feedback
    const err = await response.json();
    console.error(`Failed to save price:`, err.error);
  }
}

// Attach this function to the 'click' event of the save buttons
// e.g., saveButton.addEventListener('click', () => {
//   const amount = amountInput.value;
//   const currency = currencySelect.value;
//   saveSkillPrice('agent-123', 'translate', amount, currency);
// });
```

## Definition of Done
-   A new "Skill Pricing" section is visible on the agent editing page for agent owners.
-   The section lists all the agent's skills.
-   Each skill has corresponding input fields for price and currency.
-   The "Save" button correctly calls the API to set/update the price.
-   The "Make Free" button correctly calls the API to remove the price.
-   The UI provides clear feedback to the user upon success or failure of the operation.
-   Existing prices are correctly populated into the input fields when the page loads.
