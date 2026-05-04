# Prompt 23: E2E Playwright Test for Skill Purchase Flow

## Objective
Create an end-to-end (E2E) test using Playwright that simulates a user purchasing a skill, to ensure the entire flow works correctly from the user's perspective.

## Explanation
While unit tests verify individual pieces of logic, E2E tests validate the complete user journey. This test will automate a browser to navigate the marketplace, click a "Buy" button, and verify that the UI updates correctly after a simulated successful purchase. This is the highest level of automated testing and catches integration issues between frontend and backend.

## Instructions
1.  **Set Up Playwright:**
    *   Ensure Playwright is installed (`npm install -D @playwright/test`).
    *   The project may already have a `tests/e2e` directory.

2.  **Create a New Test File:**
    *   Create `tests/e2e/monetization.spec.js`.

3.  **Write the Test Script:**
    *   **Setup:** Before the test, you'll need to seed your test database with a user, an agent, and a priced skill.
    *   **Test Steps:**
        1.  **Login:** Programmatically log in as the test user.
        2.  **Navigate:** Go to the marketplace and find the agent's detail page.
        3.  **Find the Skill:** Locate the priced skill and the "Buy" button.
        4.  **Click Buy:** Click the button to open the purchase modal.
        5.  **Assert Modal:** Verify that the QR code modal is visible.
        6.  **Simulate Confirmation:** Since we can't scan a QR code in a test, we need a way to bypass it. You can either:
            *   Make a direct API call to a special test-only endpoint that confirms the purchase.
            *   Have the frontend polling check a mock endpoint during tests.
        7.  **Assert UI Update:** After the simulated confirmation, verify that the "Buy" button is replaced by an "Owned" badge on the page.

## Code Example (`tests/e2e/monetization.spec.js`)

```javascript
import { test, expect } from '@playwright/test';

test.describe('Skill Purchase Flow', () => {
  test.beforeEach(async ({ page }) => {
    // 1. Programmatically log in the user
    await page.goto('/login');
    // ... fill in login form ...
  });

  test('should allow a user to purchase a skill and see the UI update', async ({ page }) => {
    // 2. Navigate to the agent's page
    await page.goto('/marketplace/agents/test-agent-with-paid-skill');

    // 3. Find and click the buy button
    const buyButton = page.locator('[data-skill-id="test-skill"] .btn-buy');
    await expect(buyButton).toBeVisible();
    await buyButton.click();

    // 4. Assert that the purchase modal appears
    await expect(page.locator('#purchase-modal')).toBeVisible();

    // 5. Simulate the purchase confirmation (e.g., by calling a test API)
    await page.request.post('/api/testing/confirm-purchase', {
      data: { userId: 'test-user', skillId: 'test-skill' }
    });

    // 6. Assert that the UI updates to "Owned"
    const ownedBadge = page.locator('[data-skill-id="test-skill"] .badge.owned');
    await expect(ownedBadge).toBeVisible({ timeout: 10000 }); // Wait for polling
    await expect(buyButton).not.toBeVisible();
  });
});
```
