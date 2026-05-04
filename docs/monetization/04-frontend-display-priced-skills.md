---
status: not-started
completed_at: null
---
# Prompt 4: Frontend UI for Displaying Priced Skills

## Objective
Modify the agent detail page in the marketplace to visually distinguish between free and paid skills, and display the price for paid skills.

## Explanation
Currently, the agent detail page lists all skills uniformly. To begin building our monetization feature, users need to be able to see which skills are premium and how much they cost. This involves fetching pricing data along with agent details and updating the UI to render prices and a premium indicator.

## Instructions
1.  **Locate the Frontend Code:**
    *   In `src/marketplace.js`, find the `renderDetail` function. This function is responsible for rendering the agent's profile, including its list of skills.

2.  **Access Pricing Data:**
    *   The `renderDetail` function receives the full agent object from the API. With the backend changes from Prompt #2, this object now includes a `skill_prices` map.

3.  **Update the Skill Rendering Logic:**
    *   Inside the loop that renders the skills (likely targeting the `d-skills` element), check if a price exists for the current skill in the `skill_prices` object.
    *   **If a price exists:** Render a price badge next to the skill name. The amount will be in the smallest unit of the currency (e.g., lamports or 10^-6 for USDC). Convert this to a human-readable format (e.g., `(price.amount / 1e6).toFixed(2)` for a 6-decimal USDC).
    *   **If a price does not exist:** Render a "Free" badge to make the distinction clear.
    *   Use different CSS classes for paid vs. free badges for distinct styling.

4.  **Add CSS for Badges:**
    *   Open `/marketplace.css` and add the styles for the new price badges. Make them noticeable but not intrusive.

## Code Example (Frontend - `src/marketplace.js`)

Here's how you might modify the skill rendering part within the `renderDetail` function:

```javascript
// Inside renderDetail function, assuming 'a' is the agent object

const skillPrices = a.skill_prices || {};
const skillsArr = a.skills || []; // Assuming skills is an array of strings or objects

$('d-skills').innerHTML = skillsArr.length
    ? skillsArr.map((s) => {
        const name = typeof s === 'string' ? s : (s.name || '');
        if (!name) return ''; // Skip empty skills

        const price = skillPrices[name];
        const badge = price
            ? `<span class="price-badge price-paid">${(price.amount / 1e6).toFixed(2)} USDC</span>`
            : `<span class="price-badge price-free">Free</span>`;
            
        return `<span class="skill-entry">${escapeHtml(name)}${badge}</span>`;
    }).join(' ')
    : '<div>This Agent has no skills defined.</div>';
```

## CSS Example (`/marketplace.css`)

```css
.price-badge {
  display: inline-block;
  margin-left: 8px;
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 4px;
  vertical-align: middle;
  text-transform: uppercase;
}

.price-free {
  color: #a7f3d0; /* A light green */
  background-color: rgba(52, 211, 153, 0.1);
}

.price-paid {
  color: #fde047; /* A light yellow/gold */
  background-color: rgba(253, 224, 71, 0.1);
}
```

## Definition of Done
-   The agent detail page in the marketplace now displays badges next to each skill.
-   Paid skills show the price in a human-readable format (e.g., "1.00 USDC").
-   Free skills show a "Free" badge.
-   The badges are styled according to the CSS example and look professional.
-   The page handles agents with no skills or a mix of free and paid skills without errors.
