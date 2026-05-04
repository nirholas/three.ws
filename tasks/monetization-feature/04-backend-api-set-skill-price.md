---
status: not-started
---

# Prompt 4: API to Set Skill Prices

**Status:** Not Started

## Objective
Create a secure backend API endpoint that allows the creator of an agent to set or update the price for one of their agent's skills.

## Explanation
To enable monetization, creators need a way to manage the prices of their skills. This endpoint will provide that functionality. It must be secure, ensuring that only the agent's owner can change the prices.

## Instructions

1.  **Create the API Endpoint:**
    *   Create a new API file, e.g., `api/agent/set-skill-price.js`.
    *   This endpoint should accept a `POST` request.

2.  **Implement Authentication & Authorization:**
    *   The endpoint must be protected. Ensure a user is logged in.
    *   Verify that the authenticated user is the owner of the agent whose skill price is being set. You will need to fetch the agent's details from the database using the provided `agent_id` and compare the owner's ID with the current user's ID.

3.  **Handle the Request Body:**
    *   The request body should contain:
        *   `agent_id`: The ID of the agent.
        *   `skill_name`: The name of the skill to price.
        *   `amount`: The price in the smallest currency unit (e.g., lamports).
        *   `currency_mint`: The currency's mint address.

4.  **Update the Database:**
    *   In your `agent_skill_prices` table, perform an "upsert" operation:
        *   If a price for that `agent_id` and `skill_name` already exists, **update** it.
        *   If it doesn't exist, **insert** a new row.
    *   Return a success response.

## Code Example (Node.js / Vercel Serverless Function)

```javascript
// In /api/agent/set-skill-price.js

import { supabase } from '../_lib/supabase';
import { authenticate } from '../_lib/auth';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await authenticate(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { agent_id, skill_name, amount, currency_mint } = req.body;

  // 1. Verify ownership
  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('owner_id')
    .eq('id', agent_id)
    .single();

  if (agentError || !agent || agent.owner_id !== user.id) {
    return res.status(403).json({ error: 'You do not own this agent.' });
  }

  // 2. Upsert the price
  const { error: priceError } = await supabase
    .from('agent_skill_prices')
    .upsert({
      agent_id,
      skill_name,
      amount,
      currency_mint,
      updated_at: new Date(),
    }, {
      onConflict: 'agent_id, skill_name'
    });

  if (priceError) {
    console.error('Error setting skill price:', priceError);
    return res.status(500).json({ error: 'Failed to set skill price.' });
  }

  return res.status(200).json({ success: true });
}
```
