---
status: not-started
---

# Prompt 19: Frontend - Affiliate Dashboard Improvements

## Objective
Enhance the referral dashboard with more detailed analytics to empower affiliates and motivate them to refer more users.

## Explanation
A basic referral dashboard shows the number of signups. A great affiliate dashboard provides actionable insights. By showing affiliates a list of the users they've referred and the revenue generated from them, you turn it from a simple counter into a tool they can use to track the effectiveness of their promotional efforts.

## Instructions
1.  **Update the Backend Endpoint:**
    *   Modify the `/api/users/referrals` endpoint.
    *   In addition to the summary counts, the endpoint should also return an array of the users who have signed up with the referrer's code.
    *   The SQL query should join the `users` table with itself (`u1` and `u2`) to find users where `u2.referred_by_id` matches `u1.id`.
    *   For each referred user, return their `username` (or a masked version), their `created_at` (signup date), and the total revenue they have generated (which might require another join or a subquery on your sales table).

2.  **Enhance the Frontend HTML:**
    *   Open `profile.html` or your dedicated referral page.
    *   Below the summary stats, add a new section titled "Your Referrals".
    *   Add a table with columns for "Username", "Signup Date", and "Revenue Generated".

3.  **Update the Frontend JavaScript:**
    *   In the JavaScript file managing this page, when you fetch data from `/api/users/referrals`, look for the new array of referred users.
    *   Dynamically create and insert table rows (`<tr>`) for each referred user into the new table.
    *   Format the `signup_date` and `revenue_generated` for display.
    *   If there are no referred users, display a message like "You haven't referred any users yet. Share your code to get started!".

## Backend SQL Query Example

```sql
// In /api/users/referrals, for the detailed list
const referrals = await sql`
  SELECT
    u.username,
    u.created_at AS signup_date,
    (
      SELECT COALESCE(SUM(price_usd), 0)
      FROM royalty_ledger
      WHERE author_user_id = ${userId}
      AND source_user_id = u.id -- Assuming you link sales to the user who paid
    ) AS revenue_generated
  FROM users u
  WHERE u.referred_by_id = ${userId}
  ORDER BY u.created_at DESC;
`;

// Return this 'referrals' array along with the summary stats
```
