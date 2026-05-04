# Prompt 22: Unit Tests for Monetization Service

## Objective
Write unit tests for the `MonetizationService` class to ensure its logic is correct, robust, and reliable.

## Explanation
The `MonetizationService` will contain critical business logic related to user purchases and creator payouts. Unit tests are essential to verify that this logic works as expected, especially for edge cases like insufficient funds or duplicate purchases. This prevents bugs and provides confidence when refactoring.

## Instructions
1.  **Set Up Testing Environment:**
    *   The project appears to use `vitest`. Ensure it's configured to work with your database. You may need a separate test database and a library for mocking database calls (like `pg-mem`).

2.  **Create a Test File:**
    *   Create a new test file: `tests/monetization-service.test.js`.

3.  **Write Test Cases for Each Method:**
    *   Import the `MonetizationService`.
    *   For each public method in the service, write one or more `it` blocks.
    *   **Test Scenarios:**
        *   **`initiatePurchase`:** Test the successful creation of a pending purchase. Test that it fails if the skill is not priced. Test that it fails if the user has already bought the skill.
        *   **`confirmPurchase`:** Test that a 'pending' purchase moves to 'confirmed'.
        *   **`requestWithdrawal`:** Test a successful request. Test that it fails if the creator's balance is too low.
        *   **`gateSkillAccess`:** Test that it returns `true` for free skills, `true` for purchased skills, and `false` for un-purchased paid skills.

4.  **Run the Tests:**
    *   Use the `npm test` command to run the test suite.

## Code Example (`tests/monetization-service.test.js`)

```javascript
import { it, expect, describe, beforeEach } from 'vitest';
import { MonetizationService } from '../api/_lib/monetization-service.js';
// You'll need a way to mock your database, e.g., using an in-memory postgres instance
import { getMockDb } from './test-helpers.js'; 

describe('MonetizationService', () => {
    let service;
    let db;

    beforeEach(async () => {
        db = await getMockDb(); // Resets the mock db for each test
        service = new MonetizationService(db);
        // Seed the mock db with necessary data (users, agents, etc.)
    });

    it('should initiate a purchase successfully', async () => {
        // Setup: create a priced skill in the mock db
        
        const result = await service.initiatePurchase({ 
            userId: 'user-1', 
            agentId: 'agent-1', 
            skillId: 'skill-1' 
        });

        expect(result.purchaseId).toBeDefined();

        // Verify that a 'pending' record was created in the mock db
        const purchase = await db.findPurchaseById(result.purchaseId);
        expect(purchase.status).toBe('pending');
    });

    it('should fail to request a withdrawal with insufficient funds', async () => {
        // Setup: set a creator's balance to 50 in the mock db

        await expect(service.requestWithdrawal({
            userId: 'creator-1',
            amount: 100
        })).rejects.toThrow('Insufficient funds');
    });
});
```
