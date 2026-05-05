---
status: completed
---

# Prompt 5: Backend API - Check Skill Access

**Status:** Not Started

## Objective
Create a fast, efficient API endpoint to verify if a user has purchased access to a specific skill on a specific agent.

## Explanation
Before executing a paid skill, the system needs to check if the current user has the right to use it. This endpoint will serve that purpose. It should be highly optimized for speed, as it might be called frequently during agent interactions. It will query the `skill_purchases` table to see if a valid record exists for the given user, agent, and skill.

## Instructions
- [ ] **Create a new API file:** `api/marketplace/check-skill-access.js`.
- [ ] **Implement the endpoint logic:**
    - [ ] It should handle `GET` requests.
    - [ ] It must authenticate the user.
    - [ ] It should accept `agent_id` and `skill_name` as query parameters.
    - [ ] It will perform a lookup in the `skill_purchases` table for a matching record (`user_id`, `agent_id`, `skill_name`).
    - [ ] It should return a simple boolean `has_access` in the JSON response.

## Code Example (`api/marketplace/check-skill-access.js`)

```javascript
import { sql } from '../_lib/db.js';
import { json, method, cors, error, auth } from '../_lib/http.js';

export default async function checkSkillAccess(req, res) {
    if (cors(req, res)) return;
    if (!method(req, res, ['GET'])) return;
    const authUser = await auth(req, res);
    if (!authUser) return;

    const { agent_id, skill_name } = req.query;

    if (!agent_id || !skill_name) {
        return error(res, 400, 'bad_request', 'Missing agent_id or skill_name.');
    }

    try {
        const [purchase] = await sql`
            SELECT id FROM skill_purchases
            WHERE user_id = ${authUser.id}
              AND agent_id = ${agent_id}
              AND skill_name = ${skill_name}
            LIMIT 1;
        `;

        const has_access = !!purchase;

        return json(res, 200, { ok: true, has_access });

    } catch (e) {
        console.error('Error checking skill access:', e);
        return error(res, 500, 'server_error', 'Failed to check access.');
    }
}
```

## Tracking
- To mark this task as complete, check all boxes in the instructions and change the status in the frontmatter to `Completed`.
