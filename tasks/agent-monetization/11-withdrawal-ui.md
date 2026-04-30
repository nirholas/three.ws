# Task 11 — Frontend: Withdrawal UI

## Goal
UI inside the revenue dashboard for agent owners to request a payout of their earnings to their configured payout wallet.

## Success Criteria
- Shows available balance (net earnings minus pending withdrawals)
- Amount input with max = available balance
- Payout wallet selector (from Task 05 API) with "Add wallet" link
- Submit creates a withdrawal request and shows confirmation
- Withdrawal history table below the form
- Pending/processing withdrawals are clearly indicated

## Component Structure

Add a "Withdraw" section at the bottom of `RevenueDashboard` (Task 10) or as a sibling route `/dashboard/revenue/withdraw`.

```
Withdraw Earnings
├── Available balance: $X.XX USDC
├── Amount: [input, max = available]  [Max] button
├── To wallet: [dropdown of payout wallets]  [+ Add wallet]
├── [Request Withdrawal] button
│
└── Withdrawal History
    ├── Date | Amount | Wallet | Status | Tx
    └── ...
```

## Interactions

**On load:**
- `GET /api/billing/revenue` → derive available balance (net_total)
- `GET /api/billing/withdrawals?status=pending,processing` → subtract pending from available
- `GET /api/billing/payout-wallets` → populate wallet dropdown

**On submit:**
- Validate: amount > 0, amount ≤ available, wallet selected
- `POST /api/billing/withdrawals` with `{ amount, currency_mint, chain, to_address }`
- On success: show "Withdrawal requested. Processing typically takes 1–2 business days."
- Refresh available balance and history

**"+ Add wallet" link:**
- Opens the payout wallet form (inline or links to payout-wallets settings)

## Amount Conversion
- Display in USDC (÷ 10^6), store as lamports (× 10^6) when sending to API
- [Max] button fills input with full available balance

## Status Display
| Status | Display |
|--------|---------|
| `pending` | "Queued" (yellow badge) |
| `processing` | "Processing" (blue badge) |
| `completed` | "Sent" (green badge) + tx hash link |
| `failed` | "Failed" (red badge) |

For `completed`, show a link to the transaction on Solscan or Basescan depending on chain.

## Files to Touch
- `src/components/revenue-dashboard.jsx` — add withdrawal section
- Or add `src/components/withdrawal-panel.jsx` and import it

## Verify
1. Available balance shows correctly
2. [Max] fills the amount
3. Submit with valid amount → success message, history row appears with "Queued"
4. Submit exceeding balance → inline error "Insufficient balance"
5. No payout wallet configured → [Request Withdrawal] is disabled with tooltip "Add a payout wallet first"
