# Prompt 15: Create a Creator Dashboard for Earnings

**Status:** - [ ] Not Started

## Objective
Develop a dashboard page for creators to track their sales and earnings from the skills they've monetized.

## Explanation
To create a healthy ecosystem, creators need visibility into how their paid skills are performing. A dedicated dashboard provides them with key metrics like total revenue, number of sales, and a breakdown of earnings per skill.

## Instructions
1.  **Design the Dashboard UI:**
    *   Create a new page, e.g., `creator-dashboard.html`.
    *   This page should be accessible to logged-in users.
    *   Design sections for:
        *   **Key Metrics:** Total revenue, total sales, number of monetized skills.
        *   **Earnings Breakdown:** A table or list showing each monetized skill, its price, number of sales, and total revenue generated.
        *   **Transaction History:** A list of recent sales, including the skill, date, and amount.

2.  **Create Backend Endpoints for Dashboard Data:**
    *   Create an endpoint `/api/creators/me/dashboard-stats`.
    *   This authenticated endpoint will fetch and aggregate data for the logged-in user:
        *   Query the `agent_skill_prices` table for all skills priced by the creator.
        *   For each priced skill, query the `user_agent_skills` table to count the number of sales.
        *   Calculate total revenue and other key metrics.
        *   The endpoint should return a JSON object with all the data needed to populate the dashboard.
    *   You might want a separate, paginated endpoint for the detailed transaction history.

3.  **Connect Frontend to Backend:**
    *   In the JavaScript for `creator-dashboard.html`, make a request to the new dashboard endpoint when the page loads.
    *   Use the returned data to populate the different sections of the dashboard.
    *   Use a library for charts (e.g., Chart.js) to visualize earnings over time if desired.

## Code Example (Backend - `/api/creators/me/dashboard-stats.js`)

```javascript
import { getDB } from './_lib/db';

export default async function handler(req, res) {
  // Assume user is authenticated and we have their user_id and wallet address
  const creatorId = req.user.id;
  
  const db = getDB();
  try {
    // Get all agents owned by the creator
    const creatorAgents = await db.query('SELECT id FROM agents WHERE creator_id = $1', [creatorId]);
    const agentIds = creatorAgents.map(a => a.id);

    // Get all sales for those agents
    const sales = await db.query(
      `SELECT asp.skill_name, asp.amount, a.name as agent_name
       FROM user_agent_skills uas
       JOIN agent_skill_prices asp ON uas.agent_id = asp.agent_id AND uas.skill_name = asp.skill_name
       JOIN agents a ON uas.agent_id = a.id
       WHERE uas.agent_id = ANY($1::uuid[])`,
      [agentIds]
    );

    let totalRevenue = 0;
    let totalSales = sales.length;
    const skillBreakdown = {};

    for (const sale of sales) {
      totalRevenue += parseInt(sale.amount, 10);
      const key = `${sale.agent_name} - ${sale.skill_name}`;
      if (!skillBreakdown[key]) {
        skillBreakdown[key] = { sales: 0, revenue: 0 };
      }
      skillBreakdown[key].sales++;
      skillBreakdown[key].revenue += parseInt(sale.amount, 10);
    }
    
    res.status(200).json({
      totalRevenue,
      totalSales,
      skillBreakdown,
    });

  } catch (error) {
    console.error('Failed to fetch dashboard stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
}
```
