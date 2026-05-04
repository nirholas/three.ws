---
status: not-started
last_updated: 2026-05-04
---
# Prompt 18: Unit and Integration Tests for Monetization Service

## Objective
Write a suite of tests for the `MonetizationService` to ensure its logic is correct, robust, and reliable.

## Explanation
The monetization logic is critical and involves financial transactions, so it must be thoroughly tested. We need to create both unit tests (testing individual methods in isolation) and integration tests (testing the service's interaction with a real or mock database).

## Instructions
1.  **Set Up a Testing Framework:**
    *   Ensure a testing framework like Jest or Vitest is configured for the backend.
    *   Set up a separate test database or a mechanism to run tests in a transaction that can be rolled back, to avoid polluting the development database.

2.  **Write Unit Tests:**
    *   **Mock Dependencies:** Mock the `sql` database client and any external APIs.
    *   **Test Cases:**
        *   `setSkillPrices`: Test that it correctly formats the SQL query for upserting prices. Test that it throws an error if the user is not the agent owner.
        *   `preparePurchaseTransaction`: Mock the database calls for price/wallet lookups. Verify that the created transaction has the correct instructions, amounts, and public keys. Test the platform fee calculation.
        *   `checkSkillOwnership`: Mock database calls to simulate a user owning a skill, not owning it, and the skill being free. Test that it returns the correct access decision.

3.  **Write Integration Tests:**
    *   **Use a Test Database:** Connect to a real test database.
    *   **Test Scenarios:**
        *   Create a test user and agent.
        *   Call `setSkillPrices` and then immediately query the database to verify the price was written correctly.
        *   Simulate a purchase confirmation by first inserting a record into `user_purchased_skills` and then calling `checkSkillOwnership` to ensure it returns true.
        *   Test the `getCreatorSalesData` method by seeding some purchase data and verifying that the aggregation (total revenue, counts) is correct.

## Code Example (Jest - Unit Test Snippet)

```javascript
// In tests/services/MonetizationService.test.js
import { MonetizationService } from '../../api/_lib/services/MonetizationService';
import { sql } from '../../api/_lib/db'; // Mock this

// Mock the database
jest.mock('../../api/_lib/db', () => ({
    sql: jest.fn().mockResolvedValue([
        // mock return values here
    ]),
}));

describe('MonetizationService', () => {
    let service;
    const mockUser = { id: 'user-123' };

    beforeEach(() => {
        service = new MonetizationService(mockUser);
        sql.mockClear();
    });

    it('should block price setting if user is not the owner', async () => {
        // Mock the agent ownership check to return no agent
        sql.mockResolvedValueOnce([]);
        await expect(service.setSkillPrices('agent-abc', {})).rejects.toThrow('permission denied');
    });

    it('should correctly calculate platform fee in transaction prep', async () => {
        // Mock DB calls to return a price of 1,000,000 lamports
        // Mock web3.js calls
        // ...
        const { transaction } = await service.preparePurchaseTransaction(...);
        // Inspect the deserialized transaction to check instruction amounts
        // expect(creatorInstruction.amount).toBe(950000); // 95%
        // expect(platformFeeInstruction.amount).toBe(50000); // 5%
    });
});
```
