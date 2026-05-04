# Prompt 15: API to Fetch User's Unlocked Skills

## Objective
Create a backend API endpoint that returns a list of all skills a user has unlocked for a specific agent.

## Explanation
Now that we are storing a user's skill purchases in the database, we need a way for the frontend to retrieve this information when a page loads. This will allow us to show the correct "Unlocked" state for skills even if the user refreshes the page or visits from a new device.

## Instructions
1.  **Create a New API File:**
    *   Create a file at `/api/agents/[id]/unlocked-skills.js`. This nested route makes sense as the unlocked skills are specific to an agent for a given user.

2.  **Define the Endpoint Logic:**
    *   The endpoint should handle `GET` requests.
    *   It must be authenticated, as it's specific to the logged-in user.
    *   It needs the `agent_id` from the URL path.

3.  **Implement the Database Query:**
    *   Query the `user_unlocked_skills` table.
    *   Select the `skill_name` column.
    *   Filter by the `agent_id` from the URL and the `user_id` from the authenticated session.
    *   The endpoint should return a simple JSON array of skill name strings, for example: `{"skills": ["advanced_analysis", "creative_writing"]}`.

4.  **Add Vercel Routing:**
    *   In `vercel.json`, add a new route to handle this dynamic endpoint:
        `"/api/agents/([^/]+)/unlocked-skills"` should map to `/api/agents/[id]/unlocked-skills?id=$1`.

## Code Example (Backend - `/api/agents/[id]/unlocked-skills.js`)

```javascript
import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, wrap, error } from '../../_lib/http.js';

export default wrap(async (req, res) => {
    if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
    if (!method(req, res, ['GET'])) return;

    const user = await getSessionUser(req);
    if (!user) {
        // Return empty list for non-logged-in users instead of an error
        return json(res, 200, { skills: [] });
    }

    const url = new URL(req.url, 'http://x');
    const agentId = url.searchParams.get('id');

    if (!agentId) {
        return error(res, 400, 'validation_error', 'Agent ID is required.');
    }

    const rows = await sql`
        SELECT skill_name
        FROM user_unlocked_skills
        WHERE user_id = ${user.id} AND agent_id = ${agentId}
    `;

    const skills = rows.map(r => r.skill_name);

    return json(res, 200, { skills });
});
```

## Code Example (Vercel Routing - `vercel.json`)

```json
{
    "routes": [
        // ... other routes
        {
			"src": "/api/agents/([^/]+)/skills-pricing",
			"dest": "/api/agents/[id]/skills-pricing?id=$1"
		},
        {
			"src": "/api/agents/([^/]+)/unlocked-skills",
			"dest": "/api/agents/[id]/unlocked-skills?id=$1"
		},
        // ... other routes
    ]
}
```
