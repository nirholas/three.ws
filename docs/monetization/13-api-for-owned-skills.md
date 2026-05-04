# Prompt 13: API for Owned Skills (Backend)

## Objective
Create the backend API endpoint that provides a list of skills owned by the currently authenticated user.

## Explanation
This endpoint will power the "My Purchased Skills" page (from the previous prompt). It needs to query the database, joining across several tables (`user_skill_ownership`, `agents`, `agent_skill_prices`) to gather all the necessary information for display.

## Instructions
1.  **Create the API Endpoint:**
    *   Create a new file: `/api/users/me/owned-skills.js`.
    *   This endpoint should handle `GET` requests and must be protected by authentication.

2.  **Implement the Database Query:**
    *   The core of this endpoint is the SQL query. You need to:
        *   Select all records from `user_skill_ownership` that match the authenticated `user_id`.
        *   `JOIN` with the `agents` table on `agent_id` to get the agent's name.
        *   `LEFT JOIN` with the `agent_skill_prices` table on both `agent_id` and `skill_name` to get the price information. Note that price could have changed, so you might want to store the purchase price in the ownership table itself for historical accuracy (a task for a future prompt). For now, joining to get the *current* price is acceptable.
        *   Select the required fields: `skill_name`, `agent_id`, `agent_name`, `purchase_date` (`created_at` from the ownership table), and the price info.

3.  **Return the Data:**
    *   Execute the query and return the resulting list of skill objects as a JSON array.

## Code Example (Backend - `api/users/me/owned-skills.js`)

```javascript
import { db } from '../../_lib/database-client';

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).end();

    try {
        const userId = req.user.id; // From auth middleware

        const { rows } = await db.query(
            `
            SELECT
                uso.skill_name,
                uso.created_at AS purchase_date,
                a.id AS agent_id,
                a.name AS agent_name,
                asp.amount AS price_amount,
                asp.currency_mint AS price_currency
            FROM
                user_skill_ownership AS uso
            JOIN
                agents AS a ON uso.agent_id = a.id
            LEFT JOIN
                agent_skill_prices AS asp ON uso.agent_id = asp.agent_id AND uso.skill_name = asp.skill_name
            WHERE
                uso.user_id = $1
            ORDER BY
                uso.created_at DESC;
            `,
            [userId]
        );

        res.status(200).json(rows);

    } catch (error) {
        console.error('Failed to fetch owned skills:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}
```

## Future Improvement Note
For true historical accuracy, the `user_skill_ownership` table should be modified to store the `amount` and `currency_mint` at the time of purchase. This prevents the user's purchase history from changing if the creator later updates the skill price. This could be its own future prompt: "Refine Purchase History for Price Accuracy."
