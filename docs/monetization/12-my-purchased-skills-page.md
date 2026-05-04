# Prompt 12: "My Purchased Skills" Page

## Objective
Create a new page or a dedicated section in the user's dashboard that lists all the skills they have purchased across all agents.

## Explanation
Users need a central place to see all the premium content they've acquired. This improves user experience and provides a clear overview of their purchases. This task involves creating the UI for this page and wiring it up to a new backend endpoint.

## Instructions
1.  **Create a New HTML Page or Section:**
    *   You can either create a new file, `my-skills.html`, or add a new section to an existing dashboard page (e.g., `dashboard.html`).
    *   The page should have a clear heading like "My Purchased Skills".
    *   It should contain a list or grid element that will be populated with the purchased skills.

2.  **Frontend JavaScript Logic:**
    *   Create a new JavaScript file or add to an existing one that's loaded on the dashboard page.
    *   On page load, make a `GET` request to a new API endpoint (`/api/users/me/owned-skills`) to fetch the list of skills.
    *   For each skill returned, render an item in the list. Each item should display:
        *   The skill's name.
        *   The name of the agent it belongs to (and maybe a link to that agent's page).
        *   The date of purchase.
        *   The price paid.

3.  **UI/UX Considerations:**
    *   Include a loading state while the skills are being fetched.
    *   Display a user-friendly message if the user hasn't purchased any skills yet (e.g., "You haven't purchased any skills yet. Explore the marketplace to find new abilities for your agents!").

## HTML Example (`dashboard.html`)

```html
<!-- Add this section to the dashboard -->
<section id="my-skills">
    <h2>My Purchased Skills</h2>
    <div id="owned-skills-list" class="skills-grid">
        <!-- Skeletons for loading state -->
        <div class="skill-card-skeleton"></div>
        <div class="skill-card-skeleton"></div>
        <div class="skill-card-skeleton"></div>
    </div>
</section>
```

## JavaScript Logic Example

```javascript
async function loadOwnedSkills() {
    const container = document.getElementById('owned-skills-list');
    try {
        const response = await fetch('/api/users/me/owned-skills');
        if (!response.ok) throw new Error('Failed to fetch skills');
        
        const skills = await response.json();

        if (skills.length === 0) {
            container.innerHTML = '<p>You have not purchased any skills yet.</p>';
            return;
        }

        container.innerHTML = skills.map(skill => `
            <div class="owned-skill-card">
                <h3>${escapeHtml(skill.skill_name)}</h3>
                <p>From Agent: <a href="/marketplace/agent/${skill.agent_id}">${escapeHtml(skill.agent_name)}</a></p>
                <div class="skill-meta">
                    <span>Purchased: ${new Date(skill.purchase_date).toLocaleDateString()}</span>
                    <span>Price: ${(skill.price_amount / 1e6).toFixed(2)} USDC</span>
                </div>
            </div>
        `).join('');

    } catch (error) {
        container.innerHTML = '<p class="error">Could not load your skills. Please try again later.</p>';
        console.error('Error loading skills:', error);
    }
}

document.addEventListener('DOMContentLoaded', loadOwnedSkills);
```
