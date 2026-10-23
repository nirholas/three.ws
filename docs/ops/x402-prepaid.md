# x402 prepaid balances and batch settlement

Small x402 calls (a cent or less) used to starve the settle floor: every call
was its own on-chain transfer, and the network fee per transfer rivals the
price. The prepaid rail fixes that. A buyer deposits once, each request debits a
ledger row, and the platform pays every seller for a whole window in **one**
Solana transaction. Solana and USDC only.

## Flow

1. **Deposit.** `GET /api/x402-prepaid/deposit` returns the deposit wallet. The
   buyer sends USDC there, then `POST /api/x402-prepaid/deposit {"tx_signature"}`.
   The server reads the finalized transaction, requires exactly one signing
   sender, and credits that sender. Crediting is idempotent on the signature.
2. **Spend.** A route declared with `paidEndpoint({ mode: 'prepaid', ... })`
   still answers 402 as before (per-call payment keeps working). A buyer with a
   balance instead sends a `SIGN-IN-WITH-X` header and no `X-PAYMENT`. The price
   is **reserved** before the handler runs.
3. **Charge only success.** A normal return commits the debit. A thrown handler,
   a 5xx the handler wrote, a cancelled request or a closed response refunds the
   reservation in full. Reservations abandoned by a dead process are refunded by
   the settle cron after `PREPAID_RESERVATION_TTL_SECONDS` (600).
4. **Settle.** `x402-prepaid-settle` (hourly) sums committed, unbatched debits
   per seller, keeps sellers at or above the floor, and pays them together.
   Sellers under the floor roll into the next window.
5. **Reconcile.** `x402-prepaid-reconcile` (03:17 UTC) checks the books and
   alerts through `sendOpsAlert` on any problem.

## Why the balance is never wrong

- Debit is one statement: `UPDATE ... WHERE balance >= amount` plus the entry
  insert, so 100 parallel debits against a balance that covers 71 of them
  produce exactly 71 successes. A `CHECK (balance_atomic >= 0)` is the backstop.
- Deposits are unique on `(kind, ref)`; replaying a signature credits once.
- A debit belongs to at most one batch (claimed by a single statement), so racing
  settle crons cannot pay twice.
- A **definitive** send failure (chain rejected it, simulation failed, never left
  the process) releases the debits for the next window. An **ambiguous** failure
  parks the batches as `unconfirmed` and alerts. It is never auto-retried,
  because the transfer may have landed. Each transaction carries a memo naming
  its batch ids so an unrecorded landing can be found on-chain.

## Reconciliation

```
node scripts/x402-prepaid-reconcile.mjs            # DATABASE_URL, read-only
node scripts/x402-prepaid-reconcile.mjs --chain    # also compare the wallet's real USDC
node scripts/x402-prepaid-reconcile.mjs --dev      # in-process Postgres with real operations
```

Invariants: `deposits - debits - balances = 0`, batched debits equal batch totals,
confirmed batches equal their debits, no payer drifted, no stale reservation, no
batch stuck pending. Exit 0 clean, 1 problems, 2 unusable setup.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `X402_PREPAID_SETTLER_SECRET_BASE58` | unset | Keypair that pays sellers. Needs about 0.05 SOL for fees and the USDC float. Registered as signer `x402-prepaid-settler`. |
| `X402_PREPAID_DEPOSIT_WALLET` | the settler's address | Where buyers deposit. |
| `X402_PREPAID_SETTLE_LIVE` | unset | Must be `1` for the cron to move USDC. Otherwise it only plans and reports. |
| `X402_PREPAID_MIN_SETTLE_ATOMICS` | `1000000` | Seller floor per window (1 USDC). |
| `X402_PREPAID_MAX_PAYEES_PER_TX` | `8` | Sellers per transaction (max 12); more are split across transactions. |

Enabling live settlement moves real funds. Check `npm run db:status` first, then
`npm run db:migrate` (migration `20261023160000_x402_prepaid_ledger.sql`), fund the
settler, review the plan the cron logs, then set `X402_PREPAID_SETTLE_LIVE=1` with
`gcloud run services update ... --update-env-vars`.

## Tables

`x402_prepaid_accounts` (balance per payer, network, asset), `x402_prepaid_entries`
(every deposit and debit with state `credited | reserved | committed | refunded`),
`x402_prepaid_batches` (one row per seller per window: `pending | confirmed |
failed | unconfirmed`).

Tests: `tests/x402-prepaid-ledger.test.js` runs the real migration on PGlite.
