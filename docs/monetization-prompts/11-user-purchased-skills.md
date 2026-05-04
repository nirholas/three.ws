# Prompt 11: Display User's Purchased Skills in Profile

**Status:** - [ ] Not Started

## Objective
Create a section in the user's profile or dashboard page (`profile.html` or a new dashboard page) where they can see all the agent skills they have purchased.

## Explanation
Users need a centralized place to view their digital assets. This enhances the sense of ownership and provides a useful overview of their collection of skills.

## Instructions
1.  **Create a Backend Endpoint:**
    *   Develop an API endpoint, e.g., `/api/users/me/purchased-skills`.
    *   This endpoint should be authenticated.
    *   It should query the `user_agent_skills` table for all records matching the logged-in user's ID.
    *   To make the output more useful, it should join with the `agents` table to include details about the agent for each skill (e.g., agent name and image).
    *   The endpoint should return an array of objects, each containing skill name, agent details, and purchase date.

2.  **Develop the Frontend UI:**
    *   On the user's profile page (`profile.html`), add a new tab or section for "My Purchased Skills".
    *   When the page loads (or this section is viewed), make a request to the new API endpoint.
    *   Render the list of purchased skills. Each item in the list should display:
        *   The skill name.
        *   The name of the agent it belongs to (and maybe a thumbnail).
        *   The date of purchase.
        *   A link to the agent's detail page in the marketplace.

## Code Example (Backend - `/api/users/me/purchased-skills.js`)

```javascript
import { getDB } from './_lib/db';

export default async function handler(req, res) {
  // Assume user is authenticated
  const userId = req.user.id;

  const db = getDB();
  try {
    // This query would join user_agent_skills with agents table
    const skills = await db.query(
      `SELECT uas.skill_name, uas.created_at, a.name as agent_name, a.slug as agent_slug, a.thumbnail_url as agent_thumbnail
       FROM user_agent_skills uas
       JOIN agents a ON uas.agent_id = a.id
       WHERE uas.user_id = $1
       ORDER BY uas.created_at DESC`,
      [userId]
    );

    res.status(200).json({ skills });
  } catch (error) {
    console.error('Failed to fetch purchased skills:', error);
    res.status(500).json({ error: 'Failed to fetch skills.' });
  }
}
```

## Code Example (JavaScript for `profile.html`)

```javascript
async function loadPurchasedSkills() {
  const container = $('purchased-skills-list');
  container.innerHTML = 'Loading...';

  try {
    const response = await fetch('/api/users/me/purchased-skills');
    if (!response.ok) throw new Error('Failed to load skills');
    
    const { skills } = await response.json();

    if (!skills.length) {
      container.innerHTML = 'You have not purchased any skills yet.';
      return;
    }

    container.innerHTML = skills.map(skill => `
      <div class="skill-item">
        <img src="${skill.agent_thumbnail || '/placeholder.png'}" alt="${skill.agent_name}" class="agent-thumb">
        <div>
          <div class="skill-name">${skill.skill_name}</div>
          <div class="agent-name">for <a href="/marketplace/${skill.agent_slug}">${skill.agent_name}</a></div>
          <div class="purchase-date">Purchased on ${new Date(skill.created_at).toLocaleDateString()}</div>
        </div>
      </div>
    `).join('');

  } catch (error) {
    container.innerHTML = 'Error loading your skills.';
  }
}

// Call this function when the page loads
loadPurchasedSkills();
```
