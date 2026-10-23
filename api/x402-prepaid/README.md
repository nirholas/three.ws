# api/x402-prepaid

Buyer-facing endpoints for the x402 prepaid rail. Full design, invariants and
configuration: [docs/ops/x402-prepaid.md](../../docs/ops/x402-prepaid.md).

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/x402-prepaid/deposit` | GET | The deposit wallet, network and asset. |
| `/api/x402-prepaid/deposit` | POST `{ tx_signature }` | Verify a finalized USDC deposit and credit its sender. Idempotent; `202` while the transaction is not yet finalized. |
| `/api/x402-prepaid/balance` | GET `?payer=` | A payer's balance. |

Ledger, batcher and route hook live in [api/_lib/x402/](../_lib/x402) (`prepaid-*.js`).
Crons: [x402-prepaid-settle](../cron/x402-prepaid-settle.js), [x402-prepaid-reconcile](../cron/x402-prepaid-reconcile.js).
