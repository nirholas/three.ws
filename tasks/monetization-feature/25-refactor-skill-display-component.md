---
status: not-started
---
# Prompt 25: Refactor Skill Display Component

**Status:** Not Started

## Objective
Refactor the UI code that displays skills into a reusable component to be used across the Marketplace, Creator Dashboard, and My Agents pages.

## Explanation
You currently have similar but slightly different logic for displaying skills in multiple places. This leads to code duplication and makes future changes difficult. Creating a single, reusable function or component will improve code quality and maintainability.

## Instructions
1.  **Create a new JavaScript file, e.g., `src/components/SkillBadge.js`.**
2.  **Define a function, e.g., `createSkillBadge(skill, context)`, that generates the HTML for a single skill.**
    - `skill`: An object containing skill name, price info, ownership status, etc.
    - `context`: A string like `'marketplace'`, `'my-agents'`, or `'creator-dashboard'` to determine which buttons/info to show (e.g., show "Set Price" button in creator context).
3.  **Move all the conditional rendering logic** (free/paid, owned, purchase button, price) into this function.
4.  **Import and use this function in `marketplace.js`, `creator-dashboard.js`, and your "My Agents" script.**
5.  This simplifies the rendering loops in those files to something like:
    `container.innerHTML = skills.map(s => createSkillBadge(s, 'marketplace')).join('')`

## Code Example (`src/components/SkillBadge.js`)
```javascript
export function createSkillBadge(skill, context = 'marketplace') {
    const { name, price, isOwned, isCreator } = skill;
    let actionsHtml = '';

    if (context === 'creator-dashboard' && isCreator) {
        actionsHtml = `<button class="set-price-btn" data-skill-name="${name}">Set Price</button>`;
    } else if (price) {
        if (isOwned) {
            actionsHtml = `<span class="price-badge price-owned">Owned</span>`;
        } else {
            actionsHtml = `<button class="purchase-btn" data-skill-name="${name}">Purchase</button>`;
        }
    } else {
        actionsHtml = `<span class="price-badge price-free">Free</span>`;
    }

    return `<span class="skill-entry">${escapeHtml(name)}${actionsHtml}</span>`;
}
```
This refactoring makes the frontend codebase much cleaner and easier to manage.
