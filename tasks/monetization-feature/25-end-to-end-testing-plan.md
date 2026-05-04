# Prompt 25: End-to-End Testing Plan

## Objective
Write a comprehensive manual testing plan that a QA tester or developer can follow to validate the entire agent monetization feature from start to finish.

## Explanation
A complex feature like this has many moving parts. A structured testing plan ensures that we cover all critical paths and edge cases. This document will serve as a checklist to verify that the system works as expected before deploying to production. This is not about writing automated tests (which would be a separate, larger effort), but about defining the manual steps to confirm functionality.

## Instructions
Based on the features we've designed in the previous 24 prompts, write a detailed testing plan. Structure it into sections. For each test case, describe the prerequisite, the steps to perform, and the expected outcome.

---

## Agent Monetization: E2E Testing Plan

### **Section 1: Agent Creator Flow (Monetization Setup)**

**Test Case 1.1: Setting a Skill Price**
*   **Prerequisite:** User is logged in and has at least one agent with defined skills.
*   **Steps:**
    1.  Navigate to the agent edit page (`/agent/:id/edit`).
    2.  Go to the "Monetization" tab.
    3.  Enter a valid price (e.g., `1.50`) for a skill.
    4.  Enter an invalid price (e.g., `abc` or a negative number).
    5.  Click "Save Prices".
    6.  Reload the page.
*   **Expected Outcome:**
    *   The invalid price should show a validation error and not save.
    *   The valid price should save successfully, showing a "Saved" status/toast.
    *   After reloading, the saved price (`1.50`) should be correctly displayed in the input field.

**Test Case 1.2: Updating and Removing a Skill Price**
*   **Prerequisite:** A skill already has a price set.
*   **Steps:**
    1.  Navigate to the "Monetization" tab for the agent.
    2.  Change the price of the skill to a new value (e.g., `2.00`). Click "Save".
    3.  Clear the price input field for the skill. Click "Save".
*   **Expected Outcome:**
    *   The price should update successfully to `2.00`.
    *   Clearing the price should successfully set the price to 0 (making the skill free again). The UI should reflect this on reload.

**Test Case 1.3: Verifying Price in Marketplace**
*   **Prerequisite:** An agent is published and has a priced skill.
*   **Steps:**
    1.  Navigate to the marketplace grid view (`/marketplace`).
    2.  Find the agent.
    3.  Navigate to the agent's detail page.
*   **Expected Outcome:**
    *   The agent card in the grid should display the "$ Paid" badge.
    *   On the detail page, the skill should be listed with the correct price (e.g., "1.50 USDC").

### **Section 2: End-User Purchase Flow**

**Test Case 2.1: Successful Purchase**
*   **Prerequisite:** Logged in as a different user (not the creator). Have a Solana wallet (e.g., Phantom) with devnet USDC. The agent skill has a price.
*   **Steps:**
    1.  Go to the agent's detail page.
    2.  Click the "Purchase" button for the paid skill.
    3.  The payment modal should appear.
    4.  Click "Connect Wallet" and approve the connection in the wallet.
    5.  The modal should update to show the connected wallet.
    6.  Click "Confirm Purchase".
    7.  Approve the transaction in the wallet popup.
    8.  Wait for the on-chain and backend confirmation steps.
    9.  After the modal closes, observe the skill on the detail page.
    10. Reload the page.
*   **Expected Outcome:**
    *   The modal should show success messages at each step.
    *   After the flow completes, the skill's button should change to "Unlocked".
    *   After reloading, the button should still say "Unlocked".

**Test Case 2.2: User Rejects Wallet Transaction**
*   **Prerequisite:** Same as 2.1.
*   **Steps:**
    1.  Proceed through the purchase flow until the wallet popup asks for transaction approval.
    2.  Click "Reject" in the wallet.
*   **Expected Outcome:**
    *   The payment modal should display an error message (e.g., "Transaction rejected by user.").
    *   The modal should remain open, and the "Confirm Purchase" button should become active again.

### **Section 3: Creator Revenue & Payout Flow**

**Test Case 3.1: Verify Revenue Event**
*   **Prerequisite:** A skill has been successfully purchased (Test Case 2.1 completed). Log in as the agent creator.
*   **Steps:**
    1.  Navigate to the Dashboard, then the "Revenue" tab.
*   **Expected Outcome:**
    *   The "Current Balance" and other stats should reflect the net amount from the sale.
    *   The "Transaction History" table should show a new entry for the skill purchase, with the correct agent, skill, and net amount.

**Test Case 3.2: Manage Payout Wallet**
*   **Prerequisite:** Logged in as the creator.
*   **Steps:**
    1.  Navigate to the "Revenue" tab.
    2.  In "Payout Settings", enter a valid Solana address and click "Save".
    3.  Enter an invalid address and click "Save".
    4.  Click "Remove".
*   **Expected Outcome:**
    *   The valid address should save successfully.
    *   The invalid address should show a validation error.
    *   The "Remove" button should successfully clear the address after confirmation.

**Test Case 3.3: Request Withdrawal**
*   **Prerequisite:** Logged in as creator. Have a positive "Available Balance" and a configured payout wallet.
*   **Steps:**
    1.  Navigate to the "Revenue" tab.
    2.  Click the "Request Withdrawal" button.
*   **Expected Outcome:**
    *   A success toast/message should appear.
    *   The "Available Balance" should immediately update to $0.00.
    *   The "Withdrawal History" table should show a new entry with the status "pending".
