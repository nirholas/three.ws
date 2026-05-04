# Prompt 2: Add Purchase Button for Paid Skills

## Objective
On the agent detail page, add a dynamic "Purchase" or "Use" button for each skill, depending on whether it's paid and whether the user owns it.

## Explanation
Now that users can see which skills are paid, the next logical step is to provide a call to action. We'll add a button next to each skill. This button will be disabled for free skills (as they are implicitly available), show "Purchase" for paid skills the user doesn't own, and "Use" or "Unlocked" for paid skills they do own.

## Prequisites
*   You need a way to know which skills the current user owns. This will be built in a later prompt. For now, **assume the user owns no skills**, so the logic will only differentiate between free and paid.

## Instructions
1.  **Locate the UI Code:**
    *   Open `src/marketplace.js` and find the `renderDetail` function.
    *   Focus on the section that renders the skills list inside the element with the ID `d-skills`.

2.  **Modify the Skill Rendering Logic:**
    *   For each skill, you're already checking if it has a price.
    *   Now, add a button to the rendered HTML for each skill.
    *   The button's text and state should be conditional:
        *   If the skill is **free** (no price), the button should be disabled and perhaps say "Included".
        *   If the skill is **paid**, the button should be enabled and say "Purchase".
    *   Add a `data-skill-name` attribute to the button to easily identify which skill it corresponds to when clicked.

## Code Example (Frontend - `src/marketplace.js`)

Here is an example of how to modify the skill rendering logic within the `renderDetail` function.

```javascript
// Inside renderDetail function, an evolution of the previous prompt's code

const skillPrices = a.skill_prices || {};
// For now, assume user owns nothing. We will replace this with a real check later.
const ownedSkills = new Set();

$('d-skills').innerHTML = skillsArr.length
    ? skillsArr.map((s) => {
        const name = typeof s === 'string' ? s : (s.name || '');
        const price = skillPrices[name];
        
        let actionButton;
        if (price) {
            if (ownedSkills.has(name)) {
                actionButton = `<button class="skill-btn" disabled>Unlocked</button>`;
            } else {
                actionButton = `<button class="skill-btn purchase" data-skill-name="${escapeHtml(name)}">Purchase</button>`;
            }
        } else {
            actionButton = `<button class="skill-btn" disabled>Free</button>`;
        }

        const priceDisplay = price ? `<span class="price-paid">${(price.amount / 1e6).toFixed(2)} USDC</span>` : ``;

        return `<div class="skill-row">
                    <span class="skill-name">${escapeHtml(name)} ${priceDisplay}</span>
                    ${actionButton}
                </div>`;
    }).join('')
    : '<div>This Agent has no skills defined.</div>';
```

## CSS Example

Add these styles to `marketplace.css` for the new skill row and buttons.

```css
.skill-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.skill-row:last-child {
  border-bottom: none;
}

.skill-name {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
}

.skill-btn {
  background-color: #374151;
  color: #d1d5db;
  border: none;
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.skill-btn:disabled {
  background-color: #1f2937;
  color: #6b7280;
  cursor: not-allowed;
}

.skill-btn.purchase {
  background-color: #3b82f6;
  color: white;
}

.skill-btn.purchase:hover {
  background-color: #2563eb;
}
```
