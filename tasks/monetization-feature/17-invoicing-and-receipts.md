---
status: not-started
---

# Prompt 17: Invoicing and Receipts

**Status:** Not Started

## Objective
Generate a simple invoice or receipt for each purchase and make it accessible to the user.

## Explanation
For accounting and record-keeping, users should be able to get a receipt for their purchases.

## Instructions
- [ ] **After a successful purchase, generate a receipt.** This can be done in the backend.
- [ ] **The receipt should contain:**
    - A unique invoice number.
    - Date of purchase.
    - Buyer and seller (creator) details.
    - A description of the item (e.g., "Skill: text-to-speech for Agent X").
    - The price paid.
    - The transaction signature.
- [ ] **Store the receipt.** You can store it as a JSON object in a new `receipts` table or as a PDF in cloud storage.
- [ ] **Modify the User Purchase History page.**
    - Add a "View Receipt" link or button to each entry in the history table.
- [ ] **Create an API endpoint to fetch a single receipt** (e.g., `GET /api/receipts/:id`).
- [ ] **When a user clicks "View Receipt", display the receipt details** in a clean, printable format.
