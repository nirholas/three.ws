# Prompt 23: E2E Testing for Purchase Flow

## Objective
Write an end-to-end (E2E) test using a framework like Playwright or Cypress to simulate and validate the entire skill purchase flow.

## Explanation
As the monetization feature becomes more complex, manual testing becomes time-consuming and prone to error. An automated E2E test will ensure the core purchase functionality remains stable as we add new features or refactor code. This test will mock the blockchain interaction but validate the entire UI and API flow.

## Instructions
1.  **Set Up the Test Environment:**
    *   Ensure you have Playwright or your chosen E2E testing framework installed and configured in the project.
    *   You will need to set up a test that can handle authentication, likely by pre-setting an auth token in local storage.

2.  **Mock the Backend API:**
    *   The test should not make real payments. You need to mock the API endpoints.
    *   Mock `/api/payments/prepare-skill-purchase`: It should return a fake, but correctly structured, Solana Pay transaction response.
    *   Mock `/api/payments/check-purchase-status`: The test should control this endpoint's response, initially returning `{ status: 'pending' }` and later switching to `{ status: 'confirmed' }` to simulate a successful purchase.

3.  **Write the Test Script:**
    *   The test should perform the following steps:
        1.  Navigate to a specific agent's marketplace page.
        2.  Verify that the "Purchase" button is visible for a paid skill.
        3.  Click the "Purchase" button.
        4.  Assert that the payment modal appears and the QR code is rendered.
        5.  Trigger the mock API to switch to a "confirmed" status.
        6.  Wait for the polling mechanism to detect the change.
        7.  Assert that the modal closes automatically.
        8.  Assert that the "Purchase" button has been replaced with the "Owned" status indicator on the main page.

## Test Script Example (Playwright)

```javascript
// tests/monetization.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Skill Purchase Flow', () => {
    test('should allow a user to successfully purchase a skill', async ({ page }) => {
        const agentId = 'some-test-agent-id';
        const skillName = 'TestSkill';

        // Mock the backend APIs before navigating
        await page.route(`/api/payments/prepare-skill-purchase`, async route => {
            const json = {
                transaction: 'fake-serialized-transaction-base64',
                message: 'Test Purchase',
                reference: 'test-reference-123',
            };
            await route.fulfill({ json });
        });
        
        let purchaseStatus = 'pending';
        await page.route(`/api/payments/check-purchase-status?reference=test-reference-123`, async route => {
            await route.fulfill({ json: { status: purchaseStatus } });
        });

        // 1. Navigate to the page
        await page.goto(`/marketplace/agent/${agentId}`);

        // 2. Find and click the purchase button
        const purchaseButton = page.locator(`.purchase-skill-btn[data-skill-name="${skillName}"]`);
        await expect(purchaseButton).toBeVisible();
        await purchaseButton.click();

        // 3. Assert modal and QR code are visible
        await expect(page.locator('#payment-modal')).toBeVisible();
        await expect(page.locator('.qr-code-container svg')).toBeVisible();

        // 4. Simulate the successful payment confirmation
        purchaseStatus = 'confirmed';
        
        // 5. Assert that the modal closes and the UI updates
        await expect(page.locator('#payment-modal')).not.toBeVisible({ timeout: 10000 }); // Wait for poll
        const ownedIndicator = page.locator(`.skill-owned:has-text("Owned")`);
        await expect(ownedIndicator).toBeVisible();
        await expect(purchaseButton).not.toBeVisible();
    });
});
```
