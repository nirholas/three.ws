---
status: not-started
---

# Prompt 9: Admin - Creator Payout System

## Objective
Build a secure internal admin interface to manage and process creator payouts efficiently.

## Explanation
As creators earn money, the platform needs a robust and trustworthy system for paying them. This internal tool will allow administrators to view pending payouts, mark them as paid, and record transaction details for accounting and dispute resolution. This is a critical operational component for a monetized platform.

## Instructions
1.  **Create a New Admin Page:**
    *   In a dedicated admin section of your application, create a new page: `/admin/payouts.html`.
    *   Secure this page to ensure only authorized administrators can access it.

2.  **Backend API for Payouts:**
    *   Create a new admin-only API endpoint: `/api/admin/payouts.js`.
    *   This endpoint will have two functions:
        *   `GET`: Fetches a list of all creators who have a pending payout balance greater than zero. It should include the creator's username, their pending balance, and their preferred payout method/address.
        *   `POST`: Marks a creator's pending payouts as `completed`. It should accept a `creator_id` and a `transaction_reference` (e.g., a bank transfer ID or a blockchain transaction hash).

3.  **Frontend UI for Payouts:**
    *   The `/admin/payouts.html` page should:
        *   Fetch and display the list of pending payouts in a table.
        *   Each row should have a "Mark as Paid" button.
        *   Clicking the button should open a form/modal where the admin can enter the transaction reference.
        *   Submitting the form should call the `POST` method on the API endpoint.
        *   The UI should update to reflect the completed payout.

4.  **Update Payout Status in the Database:**
    *   The `POST` request to the API should trigger a database update.
    *   It should update the `status` of all `pending` items in the `royalty_ledger` for that creator to `paid`.
    *   It should also record the payout transaction in a new `payouts` table for auditing purposes.

## `payouts` Table SQL Example

```sql
CREATE TABLE payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_user_id UUID NOT NULL REFERENCES users(id),
    amount_usd NUMERIC(12, 2) NOT NULL,
    payout_method VARCHAR(64),
    transaction_reference TEXT,
    processed_by_admin_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
