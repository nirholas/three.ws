# Prompt 22: Marketplace Analytics Dashboard

## Objective
Create a dedicated analytics page for the marketplace that displays key metrics about agent and skill performance.

## Explanation
To create a healthy and competitive marketplace, creators and the platform administrators need data. This analytics dashboard will provide insights into which agents are most popular, which skills are selling the most, and overall revenue trends. This helps creators understand what the market wants and helps administrators monitor the health of the economy.

## Instructions
1.  **Create a New Page:**
    *   Create a new route and page, e.g., `marketplace/analytics.html`.
    *   Design the layout with charts and data tables.

2.  **Backend Analytics Endpoint:**
    *   Create a new API endpoint, `/api/marketplace/analytics`.
    *   This endpoint will perform aggregation queries to calculate stats. It should be restricted to administrators or perhaps a subset of stats could be public.
    *   **Metrics to compute:**
        *   Total marketplace volume (in USD).
        *   Number of unique buyers.
        *   Number of unique sellers (creators with at least one sale).
        *   A time-series chart of daily/weekly sales volume.
        *   Top 10 best-selling agents (by revenue).
        *   Top 10 best-selling skills (by revenue).

3.  **Frontend Visualization:**
    *   On the analytics page, fetch data from the new endpoint.
    *   Use a charting library (e.g., Chart.js, which is lightweight) to visualize the time-series data.
    *   Render the "Top 10" lists in styled tables.

## Code Example (Backend Analytics Endpoint - `/api/marketplace/analytics.js`)

```javascript
import { supabase } from '../../_lib/supabase';
import { json, error } from '../../_lib/http';

export default async function handler(req, res) {
    // Add admin authentication check here

    // Example: Fetching top selling skills
    const { data: topSkills, error: skillsError } = await supabase.rpc('get_top_selling_skills', { limit_count: 10 });

    if (skillsError) {
        return error(res, 500, 'Failed to calculate analytics.');
    }
    
    // Example: Fetching sales volume by day
    const { data: salesVolume } = await supabase.rpc('get_daily_sales_volume');

    // ...fetch other metrics...

    return json(res, {
        topSkills,
        salesVolume,
        // ...other data...
    });
}
```

## Supabase RPC Function Example (`get_top_selling_skills`)

```sql
CREATE OR REPLACE FUNCTION get_top_selling_skills(limit_count INT)
RETURNS TABLE(skill_name TEXT, agent_id UUID, total_revenue BIGINT, total_sales BIGINT) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ups.skill_name,
        ups.agent_id,
        SUM(asp.amount) as total_revenue,
        COUNT(ups.id) as total_sales
    FROM
        user_purchased_skills ups
    JOIN
        agent_skill_prices asp ON ups.agent_id = asp.agent_id AND ups.skill_name = asp.skill_name
    GROUP BY
        ups.skill_name, ups.agent_id
    ORDER BY
        total_revenue DESC
    LIMIT
        limit_count;
END;
$$ LANGUAGE plpgsql;
```
