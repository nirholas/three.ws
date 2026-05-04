# Prompt 23: Withdrawal UI

## Objective
Create the user interface in the Revenue Dashboard for creators to see their current balance and request a withdrawal.

## Explanation
This UI component will tie together the balance calculation and the withdrawal API. It should clearly display the creator's withdrawable balance and provide a simple button to initiate the payout process. It should also include a section to display the history of their withdrawal requests.

## Instructions
1.  **Locate Frontend Dashboard Code:**
    *   Open `public/dashboard/dashboard.js`.

2.  **Add Withdrawal UI Section:**
    *   In the `renderRevenue` function, add a new panel for "Withdrawals" below the Payout Settings.
    *   This panel should contain:
        *   A display for the "Available Balance" (this will use the same data from the stats API).
        *   A "Request Withdrawal" button. This button should be disabled if the balance is zero.
        *   A placeholder for a table to show withdrawal history.

3.  **Implement Withdrawal Request Logic:**
    *   Add a `click` listener to the "Request Withdrawal" button.
    *   When clicked, it should make a `POST` request to the `/api/billing/withdraw` endpoint.
    *   While the request is pending, disable the button and show a "Processing..." message.
    *   On success, display a success message (e.g., using a toast notification) and update the balance to show $0.00.
    *   On error, display the error message from the API.

4.  **Implement Withdrawal History:**
    *   Create a new API endpoint `/api/billing/withdrawals` that fetches a user's withdrawal history from the `agent_withdrawals` table (paginated).
    *   Create a function `loadWithdrawalHistory()` in `dashboard.js`.
    *   This function should fetch from the new endpoint and render the results in a table, showing the date, amount, status (`pending`, `completed`, `failed`), and destination address for each withdrawal.

## Code Example (Frontend UI - in `renderRevenue` function of `dashboard.js`)

```javascript
// In renderRevenue function, after the payout settings panel
root.innerHTML += `
    <div class="panel">
        <div class="panel-header"><h2>Withdrawals</h2></div>
        <div class="panel-body" id="withdrawal-container">
            <div class="withdrawal-balance-area">
                <span>Available Balance</span>
                <strong id="withdrawal-balance-display">Loading...</strong>
            </div>
            <button class="btn btn-primary" id="request-withdrawal-btn" disabled>Request Withdrawal</button>
            <span class="form-status" id="withdrawal-status"></span>
        </div>
    </div>
    <div class="panel">
        <div class="panel-header"><h3>Withdrawal History</h3></div>
        <div class="panel-body no-pad">
            <table id="withdrawal-history-table">
                <thead><tr><th>Date</th><th>Amount</th><th>Status</th><th>Address</th></tr></thead>
                <tbody><tr><td colspan="4">Loading history...</td></tr></tbody>
            </table>
        </div>
    </div>
`;

// In your main stats loading logic, also update the balance display here
function renderRevenueStats(stats) {
    // ...
    const balanceEl = document.getElementById('withdrawal-balance-display');
    balanceEl.textContent = formatUSDC(stats.current_balance);
    const withdrawalBtn = document.getElementById('request-withdrawal-btn');
    if (Number(stats.current_balance) > 0) {
        withdrawalBtn.disabled = false;
    }
}

// Then, add the event listener
document.getElementById('request-withdrawal-btn').addEventListener('click', handleWithdrawalRequest);

loadWithdrawalHistory(); // Also call this
```

## Code Example (Frontend JS - new functions in `dashboard.js`)

```javascript
async function handleWithdrawalRequest() {
    if (!confirm('Are you sure you want to withdraw your entire available balance?')) return;
    
    const btn = document.getElementById('request-withdrawal-btn');
    const status = document.getElementById('withdrawal-status');
    
    btn.disabled = true;
    status.textContent = 'Submitting request...';

    try {
        const res = await fetch('/api/billing/withdraw', {
            method: 'POST',
            credentials: 'include',
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error_description || 'Request failed.');

        status.textContent = body.message; // Success message from API
        // Refresh all revenue data
        const stats = await api.getRevenueStats();
        renderRevenueStats(stats);
        loadWithdrawalHistory();

    } catch (e) {
        status.textContent = `Error: ${e.message}`;
        btn.disabled = false; // Re-enable on failure
    }
}

async function loadWithdrawalHistory() {
    const tbody = document.querySelector('#withdrawal-history-table tbody');
    try {
        // Assume you create this API endpoint
        const res = await fetch('/api/billing/withdrawals', { credentials: 'include' });
        const { withdrawals } = await res.json();
        
        if (!withdrawals.length) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No withdrawal history.</td></tr>';
            return;
        }

        const formatUSDC = (amount) => `${(Number(amount) / 1e6).toFixed(2)} USDC`;
        tbody.innerHTML = withdrawals.map(w => `
            <tr>
                <td>${new Date(w.created_at).toLocaleString()}</td>
                <td>${formatUSDC(w.amount)}</td>
                <td><span class="status-badge ${w.status}">${w.status}</span></td>
                <td>${esc(w.to_address.slice(0, 4))}...${esc(w.to_address.slice(-4))}</td>
            </tr>
        `).join('');

    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" class="err">Failed to load history.</td></tr>`;
    }
}
```
You will also need to add some basic CSS for `.status-badge`.
