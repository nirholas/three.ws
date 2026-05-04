# Prompt 9: Save Skill Prices (Backend)

## Objective
Create a backend API endpoint that allows agent creators to save the prices they have set for their skills.

## Explanation
After a creator sets up the prices for their skills in the UI (from the previous prompt), we need a secure endpoint to save this information to the database. This endpoint will receive a list of skills and their prices, validate the data, and update the `agent_skill_prices` table.

## Instructions
1.  **Database Schema:**
    *   Ensure you have an `agent_skill_prices` table.
    *   Columns should include `id`, `agent_id`, `skill_name`, `amount` (as a `bigint` to store lamports), and `currency_mint` (as a string).
    *   The combination of `agent_id` and `skill_name` should be unique.

2.  **Create the API Endpoint:**
    *   Create a new file, e.g., `api/agents/[id]/skill-prices.js`.
    *   This endpoint should handle `POST` or `PUT` requests.
    *   It must be protected, ensuring only the agent's creator can update the prices.

3.  **Implement the Endpoint Logic:**
    *   The request body should contain an object or array of skill prices, like: `[{ skillName: 'DataAnalysis', price: 1.99, currency: 'USDC' }, ...]`.
    *   The handler should:
        *   Authenticate the user and verify they own the agent specified by `:id`.
        *   Iterate through the submitted skill prices.
        *   For each skill, convert the price (e.g., 1.99 USDC) into its smallest unit (lamports, e.g., 1,990,000).
        *   Perform an "upsert" operation on the `agent_skill_prices` table:
            *   If a price for that `agent_id` and `skill_name` already exists, `UPDATE` it.
            *   If it doesn't exist, `INSERT` a new row.
        *   Return a success response.

## SQL for `agent_skill_prices` Table

```sql
CREATE TABLE agent_skill_prices (
    id SERIAL PRIMARY KEY,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    skill_name VARCHAR(255) NOT NULL,
    amount BIGINT NOT NULL, -- e.g., 1_990_000 for 1.99 USDC
    currency_mint VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(agent_id, skill_name)
);
```

## Code Example (Backend - `api/agents/[id]/skill-prices.js`)

```javascript
import { db } from '../../_lib/database-client';
import { verifyAgentOwnership } from '../../_lib/auth';

const USDC_DECIMALS = 6;

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    
    try {
        const agentId = req.query.id;
        const userId = req.user.id; // From auth middleware

        // 1. Verify ownership
        if (!await verifyAgentOwnership(userId, agentId)) {
            return res.status(403).json({ error: 'You do not own this agent.' });
        }

        const { prices } = req.body; // Expects: [{ skillName, price, currencyMint }]
        if (!Array.isArray(prices)) {
            return res.status(400).json({ error: 'Invalid prices format.' });
        }
        
        // 2. Use a transaction to update all prices atomically
        await db.tx(async t => {
            for (const item of prices) {
                const { skillName, price, currencyMint } = item;
                
                // 3. Convert to lamports (smallest unit)
                const amountInLamports = Math.round(parseFloat(price) * (10 ** USDC_DECIMALS));

                await t.query(
                    `
                    INSERT INTO agent_skill_prices (agent_id, skill_name, amount, currency_mint)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (agent_id, skill_name) DO UPDATE SET
                        amount = EXCLUDED.amount,
                        currency_mint = EXCLUDED.currency_mint,
                        updated_at = CURRENT_TIMESTAMP;
                    `,
                    [agentId, skillName, amountInLamports, currencyMint]
                );
            }
        });
        
        res.status(200).json({ message: 'Skill prices updated successfully.' });

    } catch (error) {
        console.error('Error saving skill prices:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}
```
