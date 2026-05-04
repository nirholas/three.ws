# Prompt 12: Backend for Earnings Data

## Objective
Create the backend endpoint that calculates and returns the earnings data for an agent creator, including total revenue, sales count, and recent transactions.

## Explanation
The creator's earnings dashboard needs data to display. This endpoint (`/api/agents/[id]/earnings`) will be responsible for querying the database to aggregate sales data for a specific agent. It will calculate key metrics and retrieve the most recent sales to populate the UI created in the previous prompt.

## Instructions
1.  **Create New API File:**
    *   Create a new file at `api/agents/[id]/earnings.js`.

2.  **Endpoint Logic (GET):**
    *   The endpoint must handle a GET request.
    *   It must be authenticated, ensuring the user making the request is the creator of the agent.
    *   The logic will perform several database queries:
        *   Query the `user_purchased_skills` table, filtering by `agent_id`.
        *   To get the revenue, it will need to join with `agent_skill_prices` to get the `amount` for each sale.
        *   Calculate the SUM of the `amount` for total revenue.
        *   Calculate the COUNT of rows for total sales.
        *   Fetch the 10 most recent sales, ordered by `purchased_at` descending.
    *   The endpoint should return a JSON object containing `totalRevenue`, `totalSales`, `balance` (for now, same as revenue), and an array of `recentSales`.

## Code Example (`api/agents/[id]/earnings.js`)

```javascript
import { supabase } from '../../_lib/supabase';
import { json, error } from '../../_lib/http';
import { getAuthUser } from '../../_lib/auth';

export default async function handler(req, res) {
    if (req.method !== 'GET') return error(res, 405, 'Method Not Allowed');

    const { id: agentId } = req.query;
    const user = await getAuthUser(req);

    if (!user) return error(res, 401, 'Unauthorized');

    // Verify ownership
    const { data: agent, error: agentError } = await supabase
        .from('agents')
        .select('creator_id')
        .eq('id', agentId)
        .single();

    if (agentError || agent.creator_id !== user.id) {
        return error(res, 403, 'Forbidden');
    }

    // Fetch all sales for this agent
    const { data: sales, error: salesError } = await supabase
        .from('user_purchased_skills')
        .select(`
            purchased_at,
            skill_name,
            transaction_signature,
            agent_skill_prices ( amount )
        `)
        .eq('agent_id', agentId)
        .order('purchased_at', { ascending: false });

    if (salesError) {
        return error(res, 500, 'Failed to fetch sales data.');
    }

    const totalSales = sales.length;
    const totalRevenue = sales.reduce((acc, sale) => {
        // The price is on the joined table
        const price = sale.agent_skill_prices?.amount || 0;
        return acc + price;
    }, 0);

    const recentSales = sales.slice(0, 10).map(s => ({
        purchased_at: s.purchased_at,
        skill_name: s.skill_name,
        price: s.agent_skill_prices?.amount || 0,
        transaction_signature: s.transaction_signature,
    }));

    // Balance calculation would be more complex with payouts, for now it's total revenue.
    const balance = totalRevenue; 

    return json(res, {
        totalRevenue,
        totalSales,
        balance,
        recentSales,
    });
}
```
