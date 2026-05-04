---
status: not-started
---

# Prompt 7: API to List Purchased Skills

**Status:** Not Started

## Objective
Create an API endpoint that allows a logged-in user to see a list of all the skills they have purchased.

## Explanation
The frontend needs a way to know which skills the current user owns. This is useful for updating the UI on agent detail pages (e.g., showing "Owned" instead of "Buy") and for displaying a list of all purchased skills on the user's profile page.

## Instructions
- [ ] **Create a new API endpoint file** (e.g., `/api/users/my-skills.js`).
- [ ] **Endpoint Logic:**
    - [ ] Handle a `GET` request.
    - [ ] Authenticate the user to get their `user_id`.
    - [ ] Query the `skill_purchases` table for all records matching the `user_id`.
    - [ ] The query should return the `agent_id` and `skill_name` for each purchase.
- [ ] **Return the list of purchased skills as a JSON array.** For efficiency, you might return an object structure that's easy for the frontend to look up, e.g., `{ "agent_id:skill_name": true }`.

## Code Example (Node.js + @vercel/postgres)

```javascript
// In /api/users/my-skills.js

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
// ...

export default wrap(async (req, res) => {
    if (req.method !== 'GET') return error(res, 405, 'method not allowed');

    const user = await getSessionUser(req);
    if (!user) return error(res, 401, 'unauthorized');

    const { rows } = await sql`
        SELECT agent_id, skill_name
        FROM skill_purchases
        WHERE user_id = ${user.id};
    `;

    // Create a lookup map for easy access on the frontend
    const purchasedSkillsLookup = {};
    for (const row of rows) {
        purchasedSkillsLookup[`${row.agent_id}:${row.skill_name}`] = true;
    }

    return json(res, 200, { purchased: purchasedSkillsLookup });
});
```
