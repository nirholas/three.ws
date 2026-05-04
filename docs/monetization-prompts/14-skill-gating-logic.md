# Prompt 14: Implement Skill Gating Logic

**Status:** - [ ] Not Started

## Objective
Enforce access control for skills, preventing users from using or executing a paid skill unless they have purchased it.

## Explanation
Skill gating is the core of the monetization feature. Once a skill is marked as paid, the system must check for ownership before allowing it to be executed. This check should happen both on the backend (for security) and frontend (for a better user experience).

## Instructions
1.  **Backend Gating:**
    *   Identify the API endpoint that executes or "performs" a skill (e.g., `/api/agent-actions.js` or a similar handler for `perform-skill`).
    *   Before executing a skill, this endpoint must perform a check:
        *   Is the skill a paid skill for this agent? (Query `agent_skill_prices`).
        *   If it is paid, does the logged-in user own it? (Query `user_agent_skills`).
        *   If the user does not own the paid skill, return a `403 Forbidden` error with a clear message like "You must purchase this skill to use it."

2.  **Frontend UI Gating:**
    *   The UI should visually indicate that a skill is locked if it's paid and not owned.
    *   For example, on the agent detail page or in a chat interface where skills can be triggered, the button or control for a locked skill should be disabled or styled differently.
    *   When a user tries to interact with a locked skill, the UI should guide them to purchase it (e.g., by showing a tooltip or popping up the purchase modal).

## Code Example (Backend - e.g., in `/api/agent-actions.js`)

```javascript
// Inside the handler for performing a skill
export default async function handler(req, res) {
  // Assume user is authenticated
  const userId = req.user.id;
  const { agentId, skillName, args } = req.body;

  const db = getDB();

  // Check if the skill is priced
  const skillPrice = await db.getSkillPrice(agentId, skillName);

  if (skillPrice) {
    // It's a paid skill, so check for ownership
    const hasOwnership = await db.checkSkillOwnership(userId, agentId, skillName);
    if (!hasOwnership) {
      return res.status(403).json({ 
        error: 'Access Denied', 
        message: 'You must purchase this skill to use it.' 
      });
    }
  }

  // If we get here, the user has access. Proceed with skill execution.
  // ... (rest of the skill execution logic)
}
```

## Code Example (Frontend UI - Conceptual)

```javascript
// When rendering a list of skill buttons for an agent to use
function renderSkillButtons(agent, purchasedSkills) {
  const container = document.getElementById('agent-skill-buttons');
  
  container.innerHTML = agent.skills.map(skill => {
    const isPaid = !!agent.skill_prices[skill.name];
    const isOwned = purchasedSkills.includes(skill.name);
    const isLocked = isPaid && !isOwned;

    if (isLocked) {
      return `<button class="skill-btn locked" title="Purchase this skill to use it.">
                ${escapeHtml(skill.name)} (Locked)
              </button>`;
    } else {
      return `<button class="skill-btn" data-skill-name="${skill.name}">
                ${escapeHtml(skill.name)}
              </button>`;
    }
  }).join('');
}
```
