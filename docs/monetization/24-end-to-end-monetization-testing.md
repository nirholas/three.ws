# Prompt 24: End-to-End Monetization Testing

## Objective
Write a suite of end-to-end (E2E) tests to validate the entire skill monetization flow, from a user connecting their wallet to a creator seeing the sale in their dashboard.

## Explanation
The monetization flow is complex, involving multiple frontend components, backend APIs, database interactions, and on-chain transactions. Manual testing is error-prone and time-consuming. An automated E2E test suite using a framework like Playwright is essential to ensure the system is robust, secure, and reliable, especially before and after deploying changes.

## Instructions
1.  **Set up Playwright:**
    *   If not already in the project, add Playwright: `npm install -D playwright`.
    *   Configure it in `playwright.config.js`. You'll need to set up a base URL and potentially a test user account.

2.  **Set up a Test Wallet:**
    *   The tests will need a Solana wallet with devnet funds. The private key for this test wallet can be stored as a secret environment variable and used to programmatically sign transactions during the test run.

3.  **Write Test Scenarios:**
    *   Create a new test file, e.g., `tests/monetization.spec.js`.
    *   **Scenario 1: One-Time Purchase**
        *   `test.beforeAll()`: Create a test agent and a test creator user via API. Set a price on one of the agent's skills.
        *   Test that a guest user cannot purchase the skill.
        *   Test that a logged-in user can connect their wallet, navigate to the agent, click the skill, confirm, and "sign" the transaction. (Playwright can mock the wallet interaction).
        *   Test that after purchase, the skill appears as "owned".
        *   Test that the creator can log in and see the sale in their earnings dashboard.
    *   **Scenario 2: Subscription**
        *   Similar setup, but test subscribing to a tier.
        *   Test that the user gains access to all skills within that tier.
        *   Test that access is revoked after the subscription period ends (requires time-mocking or a special test setup).

## Playwright Test Example (`tests/monetization.spec.js`)

```javascript
import { test, expect } from '@playwright/test';
import { login, createTestAgent } from './test-helpers'; // Assume helper functions exist

test.describe('Skill Monetization E2E', () => {
    let agentId;
    let creatorToken;
    const skillName = 'premium_skill';

    test.beforeAll(async ({ request }) => {
        // Create a creator and an agent with a priced skill
        const creator = await login(request, 'creator');
        creatorToken = creator.token;
        const agent = await createTestAgent(request, creatorToken, {
            skills: [{ name: skillName }],
            prices: { [skillName]: { amount: 1000000, currency_mint: 'USDC_MINT' } }
        });
        agentId = agent.id;
    });

    test('a user can purchase a skill', async ({ page, context }) => {
        // Login as a buyer
        const buyer = await login(context);

        // TODO: Inject a mock wallet into the browser context for the buyer
        // This is an advanced setup but crucial for testing.

        await page.goto(`/marketplace/agents/${agentId}`);

        // Find the skill and its price badge
        const skillEntry = page.locator('.skill-entry', { hasText: skillName });
        await expect(skillEntry.locator('.price-paid')).toBeVisible();

        // Click to open purchase modal
        await skillEntry.click();
        await expect(page.locator('#purchaseModal')).toBeVisible();

        // Click "Buy Now"
        await page.locator('#confirmPurchaseBtn').click();

        // The test would now need to handle the mock wallet signing prompt
        // and wait for the post-purchase confirmation.
        
        // Assert that the UI updates to show ownership
        await expect(page.locator('.skill-entry', { hasText: skillName }).locator('.owned-badge')).toBeVisible();
    });
});
```
