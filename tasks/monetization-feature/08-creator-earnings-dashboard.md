---
status: not-started
---

# Prompt 8: Creator Earnings Dashboard

**Status:** Not Started

## Objective
Create a dashboard for creators to view their earnings from skill sales.

## Explanation
Creators need to be able to track how much they've earned. This requires a new page in the creator dashboard that shows total revenue, a list of recent sales, and other relevant analytics.

## Instructions
- [ ] **Create a new database table: `skill_sales`**. It should log every purchase:
    - `id`: Primary key.
    - `agent_id`: The agent whose skill was sold.
    - `creator_id`: The user who owns the agent.
    - `buyer_id`: The user who bought the skill.
    - `skill_name`: The name of the skill.
    - `amount`: The sale price.
    - `currency_mint`: The currency of the sale.
    - `signature`: The Solana transaction signature of the sale.
    - `created_at`: Timestamp.
- [ ] **Log every sale.** After a successful purchase is confirmed on-chain, add an entry to this table.
- [ ] **Create a new API endpoint, e.g., `GET /api/dashboard/earnings`**.
    - This endpoint should query the `skill_sales` table for the currently logged-in user.
    - It should return aggregated data (total earnings per currency) and a list of recent transactions.
- [ ] **Create a new page in the dashboard (e.g., `dashboard/earnings.html`)**.
    - This page should fetch data from the new API endpoint.
    - **Display summary cards:** "Total Earnings (USDC)", "Total Earnings (SOL)", etc.
    - **Display a table of recent sales:** Show the skill name, date, price, and buyer.
