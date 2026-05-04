---
status: not-started
---

# Prompt 22: Backend & Frontend - Tax Compliance

## Objective
Integrate a system for collecting necessary tax information (e.g., W-9 for US creators) to comply with financial regulations.

## Explanation
When you pay creators, you may be required by law to report their earnings to tax authorities. This involves collecting tax identification information from them. This process must be secure and user-friendly to ensure compliance without creating excessive friction for your creators.

**Disclaimer:** This is a complex area. Always consult with a tax professional and legal counsel. The following is a technical guide, not legal advice.

## Instructions
1.  **Choose a Compliance Partner (Recommended):**
    *   Services like Stripe Identity or Persona can securely collect and verify tax forms. This is often better than building it yourself.
    *   If using Stripe, you can require Identity verification for connected accounts before enabling payouts.

2.  **Database Fields:**
    *   In your `users` table, add fields to track tax status, such as `tax_form_status` (`missing`, `pending`, `verified`) and `tax_form_type` (`w9`, `w8ben`). Do NOT store sensitive information like Social Security Numbers directly in your database unless it is encrypted at the field level.

3.  **Create a Tax Center UI:**
    *   In the creator's "Earnings" or "Account" section, add a "Tax Information" page.
    *   This page should clearly explain *why* this information is needed.
    *   Based on the user's country (if collected), prompt them to complete the correct form (e.g., W-9 for the US, W-8BEN for non-US).
    *   Embed the UI of your chosen compliance partner (e.g., the Stripe Identity modal) to handle the secure collection of data.

4.  **Gating Payouts:**
    *   In your admin payout system (`Prompt 9`), before processing a payout, your backend must check the creator's `tax_form_status`.
    *   Do not allow payouts to be processed for any creator whose status is not `verified`, especially if their earnings are over the legal reporting threshold (e.g., $600 in the US).

5.  **Webhook for Verification Status:**
    *   Your compliance partner will provide webhooks.
    *   Implement a webhook handler to listen for events like `identity.verification_session.verified`.
    *   When you receive this event, update the `tax_form_status` for the corresponding user in your database.

## UI Flow Example

1.  User goes to the "Earnings" page.
2.  If their earnings are > $500 and their `tax_form_status` is `missing`, a prominent banner appears: "Action Required: Please submit your tax information to receive payouts."
3.  The banner links to the "Tax Information" page.
4.  User clicks a "Begin Verification" button, which launches the Stripe Identity flow.
5.  User completes the form in the secure modal.
6.  Stripe sends a webhook to your backend, and the user's status is updated to `verified`. The banner on the earnings page disappears.
