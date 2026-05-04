---
status: not-started
---

# Prompt 25: Secure Pricing and Payment APIs

**Status:** Not Started

## Objective
Perform a security review and add necessary checks to all new monetization-related API endpoints.

## Explanation
Handling payments requires a high level of security. We must ensure that only authorized users can perform sensitive actions. This prompt is a check to ensure all new endpoints have robust security measures.

## Instructions
- [ ] **Review `POST /api/agents/prices` (Prompt 3):**
    - [ ] **Check:** Does it strictly verify that the logged-in user is the owner of the `agent_id` being modified? A user should never be able to set the price for another user's agent.
- [ ] **Review Solana Pay Endpoints (Prompt 5 & 6):**
    - [ ] **Check:** When confirming a transaction, does the backend re-fetch the price from the database itself? The price should *not* be trusted from the client request, as it could be manipulated. The backend must be the source of truth for the expected amount.
    - [ ] **Check:** Is the agent creator's wallet address also fetched securely from the database on the backend, not passed from the client?
- [ ] **Review Gating Logic (Prompt 8):**
    - [ ] **Check:** Is the ownership check robust? Does it correctly handle cases where a user is not logged in?
- [ ] **Review Creator Endpoints (Prompt 14):**
    - [ ] **Check:** Do the `/api/earnings/*` endpoints correctly scope all queries to the authenticated `user_id`? A user should never be able to see another creator's earnings.
- [ ] **Add Rate Limiting:**
    - [ ] Apply rate limiting to sensitive endpoints like transaction creation and confirmation to prevent abuse.

## Code Example (Security Check in Confirmation Endpoint)

```javascript
// In the confirmation endpoint, DO NOT trust client-side price.

const { signature, agentId, skillName } = await readJson(req);

// ALWAYS re-fetch the price from the DB as the source of truth.
const [priceInfo] = await sql`
    SELECT amount, currency_mint
    FROM agent_skill_prices
    WHERE agent_id = ${agentId} AND skill_name = ${skillName}`;

if (!priceInfo) {
    return error(res, 404, 'Skill or price not found.');
}

// Now, validate the on-chain transaction against THIS `priceInfo`.
// ...
```
