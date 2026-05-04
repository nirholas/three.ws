---
status: completed
completed_at: 2026-05-04T12:05:00Z
---
# Prompt 2: Modify Agent Detail API to Include Skill Prices

## Objective
Enhance the backend API to include skill pricing information when fetching details for a specific agent.

## Explanation
Building on the new database schema, we need to make pricing data available to the frontend. The API endpoint that serves agent details for the marketplace (`/api/marketplace/agents/:id`) must be updated to join and include the prices for the skills associated with that agent.

## Instructions
1.  **Locate the API Endpoint:**
    *   Find the code responsible for handling the `GET /api/marketplace/agents/:id` request. This is likely in a file such as `api/marketplace/[action].js` or a similar route handler.

2.  **Update the Database Query:**
    *   In the function that fetches the agent's details from the database, add a `LEFT JOIN` to the `agent_skill_prices` table.
    *   The join condition should be on `agents.id = agent_skill_prices.agent_id`.

3.  **Restructure the API Response:**
    *   The database query will likely return multiple rows for the same agent if it has multiple priced skills. You need to process these rows to build a single agent object.
    *   The final agent object sent to the frontend should have a new property, `skill_prices`.
    *   This `skill_prices` property should be an object (or map) where keys are the `skill_name` and values are objects containing the `amount` and `currency_mint`.

## Code Example (Backend API Handler)

Here's a conceptual example of how to modify the data retrieval and shaping logic.

```javascript
// Example using a hypothetical database client like 'db'

async function getAgentWithSkillPrices(agentId) {
  const query = `
    SELECT
      a.*, -- all columns from agents table
      sp.skill_name,
      sp.amount,
      sp.currency_mint
    FROM
      agents a
    LEFT JOIN
      agent_skill_prices sp ON a.id = sp.agent_id
    WHERE
      a.id = $1;
  `;
  
  const { rows } = await db.query(query, [agentId]);

  if (rows.length === 0) {
    return null; // or throw 404
  }

  // Aggregate the pricing data
  const agent = {
    // Spread the first row to get agent properties
    id: rows[0].id,
    name: rows[0].name,
    description: rows[0].description,
    // ... other agent fields
    skills: rows[0].skills, // Assuming skills are stored as a JSONB array
    skill_prices: {}
  };

  rows.forEach(row => {
    if (row.skill_name && row.amount !== null) {
      agent.skill_prices[row.skill_name] = {
        amount: row.amount,
        currency_mint: row.currency_mint
      };
    }
  });

  return agent;
}

// In your API route handler:
// const agent = await getAgentWithSkillPrices(req.params.id);
// res.status(200).json(agent);
```

## Definition of Done
-   The API endpoint `GET /api/marketplace/agents/:id` is updated.
-   When an agent has priced skills, the JSON response now includes a `skill_prices` object.
-   The `skill_prices` object contains an entry for each priced skill with its `amount` and `currency_mint`.
-   If an agent has no priced skills, `skill_prices` should be an empty object `{}`.
-   The endpoint continues to function correctly for agents with no skills or no priced skills.
