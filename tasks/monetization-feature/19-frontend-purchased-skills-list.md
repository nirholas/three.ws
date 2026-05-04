---
status: not-started
---

# Prompt 19: User Profile - Purchased Skills List

**Status:** Not Started

## Objective
Create a section on the user's profile page that lists all the skills they have purchased across all agents.

## Explanation
Users need a central place to see all the premium skills they've acquired. This acts as a digital inventory and reinforces the value they've received from the platform.

## Instructions
- [ ] **Identify the Profile Page:**
    - [ ] Locate the main HTML and JavaScript files for the user profile page (e.g., `profile.html`).
- [ ] **Add a New Section:**
    - [ ] In the HTML, add a new section or tab for "Purchased Skills". It should contain a container element (e.g., `<div id="purchased-skills-list"></div>`).
- [ ] **Fetch and Render Data:**
    - [ ] In the profile page's JavaScript, on page load, make a `GET` request to the `/api/users/my-skills` endpoint.
    - [ ] The endpoint from Prompt 7 returns a list of purchases with `agent_id` and `skill_name`. You will likely need to modify that endpoint or create a new one to also return more details, like the agent's name and an icon, to make the list user-friendly.
    - [ ] A better endpoint might be `GET /api/users/my-skills-detailed`, which does the necessary `JOIN`s on the backend.
    - [ ] Once you have the data, dynamically generate HTML to display each purchased skill, showing the skill name and the agent it belongs to. Link back to the agent's detail page.

## Code Example (JavaScript for profile page)

```javascript
// On profile page load
async function loadPurchasedSkills() {
    const container = document.getElementById('purchased-skills-list');
    container.innerHTML = 'Loading...';

    try {
        // Assumes a new or modified endpoint that returns detailed info
        const response = await fetch('/api/users/my-skills-detailed');
        const { skills } = await response.json(); // skills = [{ skill_name, agent_id, agent_name, agent_avatar_url }, ...]

        if (skills.length === 0) {
            container.innerHTML = "<p>You haven't purchased any skills yet.</p>";
            return;
        }

        container.innerHTML = skills.map(skill => `
            <div class="purchased-skill-item">
                <img src="${skill.agent_avatar_url}" alt="${skill.agent_name}">
                <div>
                    <span class="skill-name">${skill.skill_name}</span>
                    <span class="agent-name">from <a href="/marketplace/agent/${skill.agent_id}">${skill.agent_name}</a></span>
                </div>
            </div>
        `).join('');

    } catch (err) {
        container.innerHTML = '<p>Could not load purchased skills.</p>';
    }
}

loadPurchasedSkills();
```
