# Prompt 9: Backend for Setting Skill Prices

## Objective
Create the backend API endpoint for agent creators to save the prices for their skills.

## Explanation
The UI for setting skill prices needs a corresponding backend endpoint to persist the data. This endpoint will receive the agent ID, skill name, price, and currency, and it will update the `agent_skill_prices` database table accordingly. This requires proper authentication to ensure only the agent's creator can modify prices.

## Instructions
1.  **Create New API File:**
    *   Create a new file, for example, at `api/agents/[id]/pricing.js`. This creates a route like `/api/agents/AGENT_ID/pricing`.

2.  **Endpoint Logic (POST/PUT):**
    *   The endpoint should handle POST or PUT requests.
    *   It needs to authenticate the request to ensure the logged-in user is the creator of the agent specified by the ID in the URL.
    *   The request body should contain `skillName`, `amount`, and `currencyMint`.
    *   The logic will perform an "upsert" operation on the `agent_skill_prices` table:
        *   If a price for that agent and skill already exists, it will be updated.
        *   If it doesn't exist, a new record will be created.

3.  **Endpoint Logic (GET):**
    *   The same endpoint should handle GET requests to fetch all existing prices for a given agent, which is used by the UI in the previous prompt.

## Database Schema (`agent_skill_prices`)

```sql
CREATE TABLE agent_skill_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES agents(id) NOT NULL,
    skill_name TEXT NOT NULL,
    amount BIGINT NOT NULL, -- Price in smallest unit (e.g., lamports)
    currency_mint TEXT NOT NULL, -- e.g., PublicKey of the SPL token
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(agent_id, skill_name)
);

-- Policy: Only agent creator can manage prices
CREATE POLICY "Creators can manage their agent skill prices"
ON agent_skill_prices
FOR ALL
USING (auth.uid() = (SELECT creator_id FROM agents WHERE id = agent_id));
```

## Code Example (`api/agents/[id]/pricing.js`)

```javascript
import { supabase } from '../../_lib/supabase';
import { json, error } from '../../_lib/http';
import { getAuthUser } from '../../_lib/auth';

export default async function handler(req, res) {
    const { id: agentId } = req.query;
    const user = await getAuthUser(req);

    if (!user) {
        return error(res, 401, 'Unauthorized');
    }

    // Verify ownership
    const { data: agent, error: agentError } = await supabase
        .from('agents')
        .select('creator_id')
        .eq('id', agentId)
        .single();

    if (agentError || agent.creator_id !== user.id) {
        return error(res, 403, 'You do not own this agent.');
    }

    if (req.method === 'POST') {
        const { skillName, amount, currencyMint } = req.body;

        if (!skillName || amount == null || !currencyMint) {
            return error(res, 400, 'Missing required pricing information.');
        }

        const { data, error: upsertError } = await supabase
            .from('agent_skill_prices')
            .upsert({
                agent_id: agentId,
                skill_name: skillName,
                amount: amount,
                currency_mint: currencyMint,
            }, { onConflict: 'agent_id, skill_name' })
            .select();

        if (upsertError) {
            return error(res, 500, 'Failed to save price.');
        }
        return json(res, data[0]);

    } else if (req.method === 'GET') {
        const { data, error: fetchError } = await supabase
            .from('agent_skill_prices')
            .select('*')
            .eq('agent_id', agentId);
        
        if (fetchError) {
            return error(res, 500, 'Failed to fetch prices.');
        }

        // Reshape into a map for easier frontend use
        const prices = data.reduce((acc, price) => {
            acc[price.skill_name] = { amount: price.amount, currency_mint: price.currency_mint };
            return acc;
        }, {});

        return json(res, prices);
    }

    return error(res, 405, 'Method Not Allowed');
}
```
