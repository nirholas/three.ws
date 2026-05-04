---
status: not-started
---

# Prompt 24: Backend Analytics for Purchases

**Status:** Not Started

## Objective
Create a basic system for tracking skill purchase analytics to understand which skills and agents are most popular.

## Explanation
To make informed business decisions, the platform needs data. Tracking sales events allows us to build dashboards showing revenue over time, top-selling skills, and top-earning creators.

## Instructions
- [ ] **Create an `analytics_events` Table:**
    - [ ] This table can be very generic to be used for other analytics later.
    - [ ] Columns: `event_name` (e.g., 'skill_purchased'), `properties` (a JSONB column to store details), `created_at`.
- [ ] **Log Events on the Backend:**
    - [ ] In the payment confirmation endpoint (from Prompt 6), after a purchase is fully verified and recorded, insert an event into the new table.
    - [ ] The `event_name` should be `'skill_purchased'`.
    - [ ] The `properties` JSON object should contain rich data about the event: `agent_id`, `skill_name`, `user_id`, `amount`, `currency_mint`, `creator_id`, etc.
- [ ] **Create a Basic Analytics API Endpoint:**
    - [ ] Create a new admin-only endpoint, e.g., `GET /api/admin/analytics/sales`.
    - [ ] This endpoint will query the `analytics_events` table.
    - [ ] It could perform aggregations, for example, to calculate total revenue per day or count the sales for each skill.
- [ ] **(Optional) Frontend Dashboard:**
    - [ ] Create a simple, admin-only page to display this data in charts and tables.

## Code Example (Backend Logging)

```javascript
// In the payment confirmation logic...

const eventProperties = {
    agentId: agent.id,
    creatorId: agent.user_id,
    skillName: skill.name,
    buyerId: user.id,
    amount: price.amount,
    currencyMint: price.currency_mint,
};

await sql`
    INSERT INTO analytics_events (event_name, properties)
    VALUES ('skill_purchased', ${JSON.stringify(eventProperties)});
`;
```
