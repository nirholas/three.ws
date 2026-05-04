---
status: not-started
---
# Prompt 16: Display Purchased Skills in "My Agents"

**Status:** Not Started

## Objective
Update the "My Agents" page to display the list of skills, including purchased premium skills, for each agent owned by the user.

## Explanation
Users need to see what skills their agents possess. This task involves enhancing the "My Agents" page to not only list the agents but also their associated skills, visually distinguishing between default/free skills and purchased ones.

## Instructions
1.  **Modify the API endpoint that serves data for the "My Agents" page** (e.g., `/api/users/me/agents`).
2.  **In the backend query, `JOIN` with the `skill_purchases` and `skills` tables** to retrieve the names of all skills purchased for each agent.
3.  **Also include the agent's base/free skills.** The final agent object in the API response should have an array like `skills: [{ name: 'wave', purchased: false }, { name: 'translator', purchased: true }]`.
4.  **In the frontend JavaScript for the "My Agents" page, update the rendering logic.**
5.  Iterate through the new `skills` array for each agent and display them, perhaps with a special icon or style for `purchased: true` skills.

## Code Example (Frontend rendering)
```javascript
// Inside the function that renders a single agent card
function renderAgent(agent) {
    const skillsHtml = agent.skills.map(skill => `
        <span class="agent-skill ${skill.purchased ? 'skill-purchased' : 'skill-free'}">
            ${skill.name}
            ${skill.purchased ? '<i class="premium-icon"></i>' : ''}
        </span>
    `).join(' ');

    return `
        <div class="agent-card">
            <h3>${agent.name}</h3>
            <div class="agent-skills-list">
                ${skillsHtml}
            </div>
        </div>
    `;
}
```
This provides a clear visual inventory for the user.
