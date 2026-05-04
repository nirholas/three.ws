---
status: not-started
---

# Prompt 24: Admin Monetization Dashboard

## Objective
Create a secure, internal dashboard for platform administrators to monitor the health and performance of the entire marketplace economy.

## Explanation
While creators have their own dashboards, platform admins need a high-level view to understand overall trends, spot potential issues, and manage the ecosystem. This is an internal tool, not for public users.

## Instructions
- [ ] **Create a Secure Admin Area:**
    - [ ] Build a new section of the application that is only accessible to users with an 'admin' role. This requires role-based access control (RBAC) in your user authentication system.

- [ ] **Backend API for Admin Stats:**
    - [ ] Create a new set of protected API endpoints, e.g., under `/api/admin/stats/`.
    - [ ] These endpoints will perform platform-wide aggregations.
    - [ ] **Key metrics to expose:**
        - [ ] **Gross Transaction Volume (GTV):** Total value of all transactions processed.
        - [ ] **Platform Revenue:** Total fees collected by the platform.
        - [ ] **Top Earning Creators:** A list of creators ranked by their total earnings.
        - [ ] **Top Selling Skills/Agents:** A list of the most purchased skills and agents.
        - [ ] **New Subscriptions/Cancellations:** A time-series chart showing subscription growth.

- [ ] **Frontend UI for Admin Dashboard:**
    - [ ] Create a new UI for the admin area.
    - [ ] Use data visualization components (charts, tables, stat cards) to present the data fetched from the admin APIs.
    - [ ] The UI should allow filtering by date ranges to analyze performance over time.

- [ ] **Add Management Tools (Advanced):**
    - [ ] Beyond just viewing data, an admin dashboard can include tools for:
        - [ ] **Refunding a purchase:** A button to trigger a refund process (this is complex and involves on-chain transactions and database updates).
        - [ ] **Disabling a skill from sale:** A toggle to remove a problematic skill from the marketplace.
        - [ ] **Managing user roles.**

## Admin API Response Example (`/api/admin/stats/overview`)

```json
{
  "dateRange": {
    "start": "2026-01-01T00:00:00.000Z",
    "end": "2026-05-04T23:59:59.999Z"
  },
  "grossTransactionVolume": 12500000000,
  "platformRevenue": 625000000,
  "activeSubscriptions": 1240,
  "newUsers": 5300
}
```

## Database Query Example (PostgreSQL for GTV)

```sql
-- Calculates Gross Transaction Volume and Platform Revenue between two dates
SELECT
    SUM(prices.amount) AS gross_transaction_volume,
    SUM(prices.amount * 0.05) AS platform_revenue -- Assuming 5% fee
FROM
    unlocked_skills AS unlocked
JOIN
    agent_skill_prices AS prices ON unlocked.agent_id = prices.agent_id AND unlocked.skill_name = prices.skill_name
WHERE
    unlocked.created_at BETWEEN $1 AND $2; -- $1 and $2 are date range parameters
```
