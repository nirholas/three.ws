---
status: completed
---
# Prompt 4: UI to Show Purchased Skills

**Status:** Not Started

## Objective
Update the marketplace and user dashboard to visually distinguish skills that the logged-in user has already purchased.

## Explanation
To prevent users from accidentally re-purchasing a skill and to provide a clear overview of their entitlements, the UI should reflect their purchase history. This requires fetching the user's purchased skills and using that information to update the rendering of skill badges.

## Instructions
1.  **Create Backend API for User Purchases:**
    -   Create a new API endpoint, e.g., `/api/users/me/purchased-skills`, that returns a list of all skill purchases for the currently authenticated user.
    -   The response should be an array of objects, like `[{ agent_id: "...", skill_name: "..." }, ...]`.

2.  **Fetch Purchased Skills on Frontend:**
    -   When a user is logged in, fetch their purchased skills from the new endpoint.
    -   Store this information in a client-side data structure that's easy to access, like a `Set` of strings in the format `agent_id:skill_name`.

3.  **Update Marketplace UI (`src/marketplace.js`):**
    -   In the `renderDetail` function, where the skill badges are rendered, modify the logic.
    -   Before rendering a "Purchase" button or a price for a paid skill, check if the user has already purchased it.
    -   If the skill is purchased, render a different badge, e.g., "Owned" or a checkmark icon, instead of the price.

4.  **Create a "My Skills" Section in Dashboard:**
    -   In the user's main dashboard (`dashboard.html` or similar), add a new section or tab called "My Purchased Skills".
    -   This section should list all the skills the user has bought, grouped by agent.
    -   This provides a centralized view for users to manage their purchased assets.

## Code Example (Frontend - `src/marketplace.js`)

```javascript
// Assuming `purchasedSkills` is a Set like: new Set(['agent123:PumpFun Tools'])
const purchasedSkills = await fetchUserPurchases(); // Fetched on page load

// ... inside renderDetail function ...

const skillPrices = a.skill_prices || {};
$('d-skills').innerHTML = skillsArr.length
    ? skillsArr.map((s) => {
        const name = typeof s === 'string' ? s : (s.name || '');
        const price = skillPrices[name];
        const purchaseKey = `${a.id}:${name}`; // e.g., 'agent123:PumpFun Tools'
        
        let badge;
        if (purchasedSkills.has(purchaseKey)) {
          badge = `<span class="price-badge price-owned">✓ Owned</span>`;
        } else if (price) {
          badge = `<span class="price-badge price-paid">${(price.amount / 1e6).toFixed(2)} USDC</span>`;
        } else {
          badge = `<span class="price-badge price-free">Free</span>`;
        }
        
        return `<span class="skill-entry">${escapeHtml(name)}${badge}</span>`;
    }).join(' ')
    : '<div>This Agent has no skills defined.</div>';

```

## CSS Example (`marketplace.css`)

```css
.price-owned {
  color: #86efac; /* A pleasant green */
  background-color: rgba(74, 222, 128, 0.1);
}
```
