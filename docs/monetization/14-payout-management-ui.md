# Prompt 14: Payout Management UI

## Objective
Add a "Settings" section to the creator dashboard where creators can manage their payout wallet address and view a history of past payouts.

## Explanation
Providing financial controls is crucial for creator trust and usability. This UI will allow creators to easily update where their funds are sent and to track when they have been paid.

## Instructions
1.  **Create Settings UI:**
    *   In `dashboard.html`, create the structure for the "Settings" tab.
    *   Add an input field, pre-filled with the creator's current payout wallet address.
    *   Include a "Save" button next to the input field.
    *   Add a section for "Payout History" with a placeholder for a table. The table should have columns for `Date`, `Amount`, and `Transaction Signature`.

2.  **Implement Update Logic:**
    *   In `dashboard.js`, add an event listener to the "Save" button.
    *   When clicked, it should take the value from the input field, validate it as a Solana public key, and send it to the backend agent update endpoint (`/api/agents/:id`, similar to Prompt 10).
    *   Provide feedback (e.g., "Saved successfully" or "Invalid address") to the user.

3.  **Fetch and Display Payout History (Future Prompt):**
    *   This prompt focuses on the UI. A future prompt will cover creating the backend logic and a `payouts` table to store and serve the data for the "Payout History" section. For now, the table can remain empty or contain placeholder data.

## Code Example (HTML - `dashboard.html` Settings Tab)
```html
<div id="settings-tab" class="tab-content hidden">
  <h2>Settings</h2>
  <div class="setting-item">
    <h3>Payout Wallet</h3>
    <p>This is the Solana wallet where your earnings will be sent.</p>
    <input type="text" id="payout-wallet-input" value="CURRENT_WALLET_ADDRESS_FROM_API">
    <button id="save-payout-wallet">Save</button>
  </div>
  <div class="setting-item">
    <h3>Payout History</h3>
    <table id="payout-history-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Amount</th>
          <th>Transaction</th>
        </tr>
      </thead>
      <tbody>
        <!-- Payout rows will be populated here -->
        <tr>
          <td>2026-05-01</td>
          <td>15.50 USDC</td>
          <td><a href="#">view on explorer</a></td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
```
