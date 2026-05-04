---
status: not-started
---

# Prompt 6: API to List Purchased Skills

**Status:** Not Started

## Objective
Create a backend API endpoint that returns a list of all skills a specific user has purchased.

## Explanation
The frontend needs a way to know which skills the current user owns so it can update the UI accordingly (e.g., change a "Purchase" button to "Owned" or "Unlocked"). This endpoint provides that data.

## Instructions

1.  **Create the API Endpoint:**
    *   Create a new endpoint, for example, `/api/user/purchased-skills.js`.
    *   This should handle `GET` requests.

2.  **Authentication:**
    *   The endpoint must be protected. The user must be logged in to view their own purchased skills.

3.  **Query the Database:**
    *   Fetch the authenticated user's ID.
    *   Query the `skill_purchases` table for all records where `user_id` matches the current user's ID.
    *   You might want to join with the `agents` table to get more details about the agent whose skill was purchased.

4.  **Format and Return the Data:**
    *   Return an array of purchased skill objects. Each object could contain `agent_id`, `agent_name`, `skill_name`, and `purchased_at`.

## Code Example (Node.js / Vercel Serverless Function)

```javascript
// In /api/user/purchased-skills.js

import { supabase } from '../_lib/supabase';
import { authenticate } from '../_lib/auth';

export default async function handler(req, res) {
  const user = await authenticate(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data, error } = await supabase
    .from('skill_purchases')
    .select(`
      skill_name,
      created_at,
      agent:agents (
        id,
        name,
        avatar_uri
      )
    `)
    .eq('user_id', user.id);

  if (error) {
    console.error('Error fetching purchased skills:', error);
    return res.status(500).json({ error: 'Failed to fetch purchased skills.' });
  }

  // Format the data to be more convenient for the client
  const formattedData = data.reduce((acc, purchase) => {
    const agentId = purchase.agent.id;
    if (!acc[agentId]) {
      acc[agentId] = [];
    }
    acc[agentId].push(purchase.skill_name);
    return acc;
  }, {});
  // Result format: { "agent_id_1": ["skill_1", "skill_2"], "agent_id_2": ["skill_3"] }


  return res.status(200).json(formattedData);
}
```
