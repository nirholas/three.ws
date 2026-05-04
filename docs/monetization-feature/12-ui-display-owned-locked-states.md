---
status: not-started
---

# Prompt 12: UI - Display "Owned" and "Locked" States

**Status:** Not Started

## Objective
Enhance the UI to clearly show which skills a user owns and which paid skills are "locked" (not yet purchased).

## Explanation
To provide a clear and intuitive user experience, the marketplace needs to visually communicate the status of each skill relative to the current user. We've already added a "Buy" button, but we can make the distinction clearer with "Owned" badges for purchased skills and perhaps a "lock" icon for paid skills the user doesn't own.

## Instructions
1.  **Style the "Owned" badge:**
    - In `marketplace.css`, add a style for the `price-owned` class that you might have added in a previous step. This should be visually distinct from the "Free" and "Paid" badges (e.g., using a different color).

2.  **Add a "Locked" icon:**
    - For paid skills that the user has *not* purchased, add a lock icon next to the skill name or "Buy" button.
    - You can use an SVG icon for this.
    - The logic for this is already in place from when you added the "Buy" button: if a skill has a price and is not in the `purchased_skills` list, it is "locked."

3.  **Update the rendering logic:**
    - In `src/marketplace.js` within the `renderDetail` function, update the skill rendering map to include these new visual elements.

## Code Example (CSS in `/marketplace.css`)

```css
/* Add this to your existing badge styles */
.price-owned {
  color: #818cf8; /* Indigo */
  background-color: rgba(129, 140, 248, 0.1);
}

.skill-entry .lock-icon {
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-right: 4px;
  vertical-align: middle;
  opacity: 0.6;
}
```

## Code Example (Frontend - `src/marketplace.js`)

```javascript
// Inside renderDetail function, updated map logic

$('d-skills').innerHTML = skillsArr.length
    ? skillsArr.map((s) => {
        const name = typeof s === 'string' ? s : (s.name || '');
        const price = skillPrices[name];
        let badgeHTML = `<span class="price-badge price-free">Free</span>`;
        let iconHTML = '';

        if (price) {
            if (purchasedSkills.has(name)) {
                badgeHTML = `<span class="price-badge price-owned">Owned</span>`;
            } else {
                const priceInUSDC = (price.amount / 1e6).toFixed(2);
                iconHTML = `<svg class="lock-icon" ... SvgForLock ...></svg>`;
                badgeHTML = `
                    <span class="price-badge price-paid">${priceInUSDC} USDC</span>
                    <button class="buy-skill-btn" data-agent-id="${a.id}" data-skill-name="${name}">Buy</button>
                `;
            }
        }
        return `<span class="skill-entry">${iconHTML}${escapeHtml(name)}${badgeHTML}</span>`;
    }).join(' ')
    : '<div>This Agent has no skills defined.</div>';
```

## Verification
- Log in and navigate to an agent detail page with a mix of free, paid, and owned skills.
- Verify that free skills have the "Free" badge.
- Verify that paid skills you haven't bought have a lock icon and a "Buy" button.
- Verify that skills you own have the new "Owned" badge and no "Buy" button.
- The visual appearance should be clear and easy to understand at a glance.
- Log out and ensure no "Owned" badges or lock icons are displayed.
