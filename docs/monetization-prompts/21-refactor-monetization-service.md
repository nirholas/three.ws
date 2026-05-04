# Prompt 21: Refactor Monetization Logic into a Service Class

## Objective
Organize all backend monetization logic (price checks, purchase creation, balance updates) into a dedicated, reusable `MonetizationService` class to improve code structure and maintainability.

## Explanation
As the monetization feature grows, its logic becomes scattered across different API endpoints and workers. Consolidating this logic into a single service class makes the code cleaner, easier to test, and reduces duplication. The service will act as the single source of truth for all monetization-related database interactions.

## Instructions
1.  **Create the Service File:**
    *   In `api/_lib/`, create a new file named `monetization-service.js`.

2.  **Define the `MonetizationService` Class:**
    *   The class constructor can accept a database connection object.
    *   **Methods to Create:**
        *   `setSkillPrice({ agentId, skillId, amount, ... })`
        *   `removeSkillPrice({ agentId, skillId })`
        *   `initiatePurchase({ userId, agentId, skillId })`
        *   `confirmPurchase({ purchaseId, transactionId })`
        *   `gateSkillAccess({ userId, agentId, skillId })`
        *   `getCreatorEarnings({ userId })`
        *   `requestWithdrawal({ userId, amount })`
        *   `processPayout({ payoutId, transactionId })`

3.  **Implement Method Logic:**
    *   Move the corresponding SQL queries and business logic from the various API endpoints (e.g., `purchase.js`, `earnings.js`) into the methods of this class.
    *   The API endpoints will become much thinner, primarily responsible for handling HTTP requests/responses and calling the service methods.

4.  **Refactor API Endpoints:**
    *   Go back to the API files (`purchase.js`, `skill-prices.js`, etc.).
    *   Instantiate the `MonetizationService` at the top of each file.
    *   Replace the raw `sql` calls with calls to the service's methods.

## Code Example (`monetization-service.js`)

```javascript
import { sql } from './db.js';

export class MonetizationService {
    constructor(db) {
        this.db = db;
    }

    async initiatePurchase({ userId, agentId, skillId }) {
        // ... logic from 'api/marketplace/purchase.js' goes here ...
        const [priceInfo] = await this.db`...`;
        // ...
        const [purchase] = await this.db`
            INSERT INTO user_skill_purchases (...) VALUES (...) RETURNING id
        `;
        return { purchaseId: purchase.id, ... };
    }

    // ... other methods ...
}

// In an API file like `api/marketplace/purchase.js`
import { MonetizationService } from '../_lib/monetization-service.js';
const monetizationService = new MonetizationService(sql);

// ... in the handler
const result = await monetizationService.initiatePurchase({ userId: user.id, ...body });
return json(res, result);
```
