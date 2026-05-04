---
status: not-started
last_updated: 2026-05-04
---
# Prompt 16: Refactor Monetization Logic into a Service Class

## Objective
To improve code organization and reusability, refactor the scattered monetization logic (database queries, transaction building) into a dedicated `MonetizationService` class.

## Explanation
As the monetization feature grows, the logic becomes more complex. Keeping it directly inside API handlers makes it hard to maintain, test, and reuse. A service class will encapsulate all the business logic related to skill pricing, purchases, and payouts, providing a clean interface for the API layer.

## Instructions
1.  **Create a New Service File:**
    *   Create a file at `api/_lib/services/MonetizationService.js`.

2.  **Design the `MonetizationService` Class:**
    *   The constructor can take a database connection object (`sql`) and the current user's session as arguments.
    *   Create methods that map to the core operations we've built:
        *   `getSkillPricesForAgent(agentId)`
        *   `setSkillPrices(agentId, prices)`
        *   `preparePurchaseTransaction(agentId, skillName)`
        *   `confirmPurchase(agentId, skillName, signature)`
        *   `checkSkillOwnership(agentId, skillName)`
        *   `getCreatorSalesData()`

3.  **Migrate Logic into the Service:**
    *   Move the database queries and transaction-building logic from the API handlers (`api/marketplace/[action].js`, `api/skills/purchase-prep.js`, etc.) into the corresponding methods of the new service class.
    *   The API handlers should become much thinner; their primary role will be handling HTTP requests/responses, validating input, and calling the service methods.

4.  **Refactor API Handlers:**
    *   Update all relevant API handlers to instantiate and use the `MonetizationService`.

## Code Example (`MonetizationService.js`)

```javascript
import { sql } from '../db.js';
import { Connection, ... } from '@solana/web3.js';
// ... other imports

export class MonetizationService {
    constructor(user) {
        this.user = user;
    }

    async setSkillPrices(agentId, prices) {
        if (!this.user) throw new Error('Authentication required.');

        // Verify ownership
        const [agent] = await sql`...`;
        if (!agent) throw new Error('Agent not found or permission denied.');

        // Perform the database upsert logic here...
    }

    async preparePurchaseTransaction(agentId, skillName) {
        if (!this.user) throw new Error('Authentication required.');

        // All the logic for fetching prices, wallets, and building
        // the VersionedTransaction goes here...
        // Returns the serialized transaction.
    }

    // ... other methods
}
```

## Code Example (Refactored API Handler)

```javascript
// api/skills/purchase-prep.js
import { MonetizationService } from '../../_lib/services/MonetizationService.js';
// ...

export default wrap(async (req, res) => {
    const user = await getSessionUser(req);
    // ... input validation

    try {
        const monetizationService = new MonetizationService(user);
        const { transaction } = await monetizationService.preparePurchaseTransaction(
            req.body.agent_id,
            req.body.skill_name
        );
        return json(res, 200, { transaction });
    } catch (e) {
        // Handle specific errors from the service for better status codes
        return error(res, 500, 'prep_failed', e.message);
    }
});
```
