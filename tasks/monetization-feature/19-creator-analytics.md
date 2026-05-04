---
status: not-started
---
# Prompt 19: Creator Analytics Page

**Status:** Not Started

## Objective
Create a basic analytics page for creators to view their sales and total revenue.

## Explanation
Providing creators with data on their skill performance is crucial for a healthy ecosystem. This task involves creating a new page and API endpoint to display simple metrics like total sales, revenue, and a list of recent transactions.

## Instructions
1.  **Backend: Create a new API endpoint `GET /api/creator/analytics`.**
    - This endpoint should be authenticated.
    - It should query the `skill_purchases` table, filtering for skills created by the logged-in user.
    - Calculate aggregate data: `total_sales`, `total_revenue`.
    - Retrieve the last 10-20 purchase records (`skill_name`, `purchase_at`, `purchase_amount`).
    - Return this data as a JSON object.
2.  **Frontend: Create a new page `public/creator-analytics.html`.**
3.  **Add a new script `src/creator-analytics.js`.**
4.  **On page load, fetch data from the new analytics endpoint.**
5.  **Render the data in a user-friendly way:**
    - Display "Total Revenue" and "Total Skills Sold" in prominent stat boxes.
    - Show a table of "Recent Sales" with details for each transaction.

## Code Example (Backend - SQL Query for Analytics)
```sql
SELECT
    COUNT(*) AS total_sales,
    SUM(p.purchase_amount) AS total_revenue
FROM skill_purchases p
JOIN skills s ON p.skill_id = s.id
WHERE s.creator_id = $1; -- $1 is the authenticated user's ID
```
This gives creators valuable insight and encourages them to build more high-quality skills.
