# Prompt 14: Creator Dashboard - Backend

## Objective
Create the backend API endpoints required to power a dashboard for creators to track their sales and earnings.

## Explanation
To empower creators, we need to give them visibility into their performance. This involves creating secure, read-only endpoints that aggregate sales data from the database.

## Instructions
1.  **Design API Endpoints:**
    *   Plan a few key endpoints for the creator dashboard. For example:
        *   `GET /api/creator/dashboard/stats`: Returns key stats like total revenue, total sales, and average sale price.
        *   `GET /api/creator/dashboard/sales-history`: Returns a paginated list of individual sales, including skill name, date, and amount earned.
        *   `GET /api/creator/dashboard/sales-by-skill`: Returns an aggregate of sales grouped by skill name.

2.  **Implement `stats` Endpoint:**
    *   This endpoint should be protected by authentication.
    *   It needs to query your transaction or unlocked skills database.
    *   To get total revenue, you'll need to join your `unlocked_skills` table with `agent_skill_prices` and filter by the agents owned by the current user (`req.user.id`).
    *   Sum the prices of all skills sold. Remember to subtract the platform fee from the creator's view of revenue.
    *   Return the aggregated data as a JSON object.

3.  **Implement `sales-history` Endpoint:**
    *   This endpoint will also perform a join similar to the stats endpoint.
    *   Instead of aggregating, it will return a list of individual sales records.
    *   Implement pagination using `LIMIT` and `OFFSET` in your SQL query (or the equivalent in your ORM) to handle potentially large numbers of sales.
    *   Return the list and pagination metadata (e.g., `total_pages`, `current_page`).

## Database Query Example (PostgreSQL for Stats)

```sql
-- This query calculates total revenue and sales for a specific creator (user_id = $1)
SELECT
    -- Sum of prices, adjusted for platform fee (e.g., 5%)
    SUM(prices.amount * (1 - 0.05)) AS total_revenue,
    COUNT(unlocked.id) AS total_sales
FROM
    unlocked_skills AS unlocked
JOIN
    agents ON unlocked.agent_id = agents.id
JOIN
    agent_skill_prices AS prices ON unlocked.agent_id = prices.agent_id AND unlocked.skill_name = prices.skill_name
WHERE
    -- Filter for sales of agents owned by the logged-in creator
    agents.creator_id = $1;
```

## API Response Example (`/stats`)

```json
{
  "totalRevenue": 85500000,
  "totalSales": 92,
  "topSellingSkill": "AdvancedDataAnalysis",
  "currency": "USDC"
}
```
