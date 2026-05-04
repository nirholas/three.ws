# Prompt 15: Transaction History

## Objective
Create a transaction history page or dashboard section for both users (buyers) and creators (sellers) to view past transactions.

## Explanation
Transparency is key for any platform dealing with payments. Users should be able to see a clear record of their purchases, and creators should be able to track their sales. This task involves creating a new database table to log transactions and building the UI and API to display this history.

## Instructions
1.  **Database Schema:**
    *   Create a `transactions` table to log every purchase.
    *   Columns should include: `id`, `buyer_user_id`, `creator_user_id`, `agent_id`, `skill_name`, `amount`, `platform_fee`, `currency_mint`, `signature`, and `created_at`.

2.  **Log Transactions (Backend):**
    *   In your payment confirmation logic (`api/payments/prepare-skill-purchase.js` `GET` handler), after verifying the transaction and granting skill access, insert a new record into this `transactions` table.

3.  **Create API Endpoint(s) (Backend):**
    *   Create an endpoint `/api/users/me/transaction-history` that returns transactions where the user is either the `buyer_user_id` or the `creator_user_id`.
    *   You could add a query parameter `?role=buyer` or `?role=seller` to filter the results.

4.  **Build the UI (Frontend):**
    *   In the user's dashboard, create a new "Transaction History" tab or section.
    *   Fetch data from the new endpoint.
    *   Display the transactions in a table or list format.
    *   The view should clearly distinguish between sales and purchases. For each transaction, show details like date, item, amount, role (Buyer/Seller), and a link to the transaction on a block explorer like Solscan.

## Code Example (Backend - Logging the transaction)

```javascript
// Inside the payment confirmation (GET handler) after successful verification

// ...
await grantSkillToUser(purchaseDetails.userId, purchaseDetails.skillName);

// Now, log the transaction
await logTransaction({
    buyerUserId: purchaseDetails.userId,
    creatorUserId: purchaseDetails.creatorId, // You need to fetch/store this
    agentId: purchaseDetails.agentId,
    skillName: purchaseDetails.skillName,
    amount: purchaseDetails.amount,
    platformFee: calculatedPlatformFee,
    currencyMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6d',
    signature: req.query.signature
});

res.status(200).json({ status: 'ok', message: 'Purchase confirmed!' });
```

## UI Table Example (`dashboard.html`)

```html
<section>
    <h2>Transaction History</h2>
    <div class="table-wrapper">
        <table>
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Details</th>
                    <th>Amount</th>
                    <th>Tx</th>
                </tr>
            </thead>
            <tbody id="transaction-history-body">
                <!-- Rows will be injected here -->
            </tbody>
        </table>
    </div>
</section>
```
