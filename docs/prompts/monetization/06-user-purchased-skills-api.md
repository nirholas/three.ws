---
status: not-started
---
# Prompt 6: User's Purchased Skills API and UI

## Objective
Create a dedicated API endpoint and a new UI section in the user's dashboard to display all the skills they have purchased across all agents.

## Explanation
Users need a central place to see all their purchased assets. This enhances the user experience by providing a clear record of their purchases and reinforces the value of their account on the platform.

## Instructions
1.  **Create Backend API Endpoint:**
    *   Create a new endpoint, e.g., `GET /api/users/me/skills`.
    *   This endpoint should be authenticated and retrieve the current user's ID.
    *   Query the `skill_purchases` table for all `completed` purchases made by the user.
    *   Join the data with the `agents` and `skills` tables to return rich information for each purchase, such as the skill name, the agent it belongs to, the agent's avatar, and the purchase date.

2.  **Create Dashboard Page:**
    *   Create a new HTML file for the dashboard page, e.g., `dashboard.html`, if it doesn't exist.
    *   Add a new section or tab to this page titled "My Purchased Skills".

3.  **Fetch and Render Skills:**
    *   In the corresponding JavaScript file for the dashboard (`dashboard.js`), fetch the data from the `/api/users/me/skills` endpoint when the page loads.
    *   Render the purchased skills in a user-friendly list or grid format.
    *   Each item should display the skill name, the agent's name, and an avatar, and link back to that agent's detail page in the marketplace.

## Code Example (Frontend - `dashboard.js`)
```javascript
async function renderPurchasedSkills() {
    const container = document.getElementById('purchased-skills-container');
    container.innerHTML = 'Loading...';

    try {
        const skills = await get('/api/users/me/skills'); // Your API helper

        if (!skills || skills.length === 0) {
            container.innerHTML = '<p>You have not purchased any skills yet.</p>';
            return;
        }

        container.innerHTML = skills.map(skill => `
            <div class="purchased-skill-card">
                <img src="${skill.agent_avatar_url}" alt="${skill.agent_name}" class="purchased-skill-avatar" />
                <div class="purchased-skill-info">
                    <h4 class="purchased-skill-name">${escapeHtml(skill.name)}</h4>
                    <p class="purchased-skill-agent">for <a href="/marketplace/agent/${skill.agent_id}">${escapeHtml(skill.agent_name)}</a></p>
                </div>
                <div class="purchased-skill-date">
                    Purchased on ${new Date(skill.purchase_date).toLocaleDateString()}
                </div>
            </div>
        `).join('');
    } catch (error) {
        container.innerHTML = '<p>Failed to load your purchased skills.</p>';
        console.error(error);
    }
}
```
