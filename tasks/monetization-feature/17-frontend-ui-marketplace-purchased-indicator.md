---
status: not-started
---
# Prompt 17: "Owned" Indicator in Marketplace

**Status:** Not Started

## Objective
Refine the marketplace UI to clearly show when a paid skill has already been purchased for the currently viewed agent.

## Explanation
This is a follow-up to Prompt #10. The goal is to prevent users from re-purchasing skills they already own. The "Purchase" button should be replaced with a non-interactive "Owned" badge or similar indicator.

## Instructions
1.  **Ensure the agent detail API endpoint (`/api/marketplace/agents/:id`) includes information about which skills are owned.**
    - This endpoint should return an array of skill names or IDs that have been purchased for this specific agent, for example, `owned_skills: ["translator", "weather_forecast"]`.
2.  **In `src/marketplace.js`, within the `renderDetail` function, use this `owned_skills` array.**
3.  **When rendering the list of skills, check if the current skill's name exists in the `owned_skills` array.**
4.  **Use conditional logic:**
    - If `owned_skills.includes(skill.name)`, render the "Owned" badge.
    - Otherwise, render the "Purchase" button for the priced skill.

## Code Example (Revisiting `src/marketplace.js`)
```javascript
// Inside renderDetail, assuming 'a' is the agent object from the API
const ownedSkills = a.owned_skills || []; 

// ... inside the skill mapping logic ...
const isOwned = ownedSkills.includes(name);

if (price && isOwned) {
    badgeHtml = `<span class="price-badge price-owned">Owned</span>`;
} else if (price && !isOwned) {
    badgeHtml = `<button class="purchase-btn" data-skill-name="${name}">Purchase</button>`;
} else {
    badgeHtml = `<span class="price-badge price-free">Free</span>`;
}
```
This provides an intuitive user experience and prevents accidental duplicate purchases.
