---
status: not-started
---

# Prompt 16: User Purchase History

**Status:** Not Started

## Objective
Create a page in the user's dashboard where they can see a history of all their skill purchases.

## Explanation
Users need a way to track their spending and see which skills they've bought. This is important for transparency and user trust.

## Instructions
- [ ] **Create a new API endpoint, e.g., `GET /api/users/me/purchases`**.
    - This should query the `skill_sales` table for all records where the `buyer_id` matches the current user.
    - It should return a list of purchases with details like agent name, skill name, price, and date.
- [ ] **Create a new page in the user dashboard (e.g., `dashboard/history.html`)**.
- [ ] **On this page, fetch the purchase history** from the new API endpoint.
- [ ] **Display the purchases in a clean, readable table.**
- [ ] **For each purchase, include a link to the Solana transaction on an explorer** like Solscan or X-Ray. The transaction signature is stored in the `skill_sales` table.
