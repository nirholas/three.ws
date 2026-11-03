---
slug: payments-withdrawal-send-idempotency
title: Withdrawal payouts become idempotent so a failed-after-broadcast send can never be paid twice
tier: P0
score: 92
area: payments
sources: docs/financial-controls.md
---

## Why this matters

The payout cron claims a withdrawal row, broadcasts a USDC transfer, and on any exception marks the row `failed`. A failure after the transaction was broadcast (confirmation timeout, RPC error after send) therefore records `failed` while funds may already have moved, and the balance checks only count `pending|processing|completed`, so the balance is freed and the user can withdraw the same money again. This is a double-payout window on a live money rail and is listed as an open gap in the financial controls register.

## Current state (measured by the reviewer on 2026-11-03)

- `api/cron/[name].js` `handleProcessWithdrawals` (registered at lines ~114-115 as `process-withdrawals` and `monetization-payouts`, body from ~4272) claims to `processing`, calls `transferSolanaUSDC` or `sendEvmUsdc`, and sets `status='failed'` in the catch block with a comment acknowledging funds may have moved.
- `api/monetization/withdrawals.js` (~256-290) and `api/billing/withdrawals/index.js` compute reserved balance from `pending|processing|completed` only.
- No `broadcast_signature` / `tx_hash` is persisted before the send, and there is no reconciliation step that checks the chain for a signature of a `failed` row.
- `docs/financial-controls.md` is the gap register (dated about 2026-09-17).

## Step 0: re-derive the current state

```
grep -n "handleProcessWithdrawals" "api/cron/[name].js"
sed -n 4272,4520p "api/cron/[name].js"
grep -rn "'pending', 'processing', 'completed'\|pending.*processing.*completed" api/monetization/withdrawals.js api/billing/withdrawals/index.js
grep -rln "withdrawals" api/_lib/migrations | tail
npm run db:status
```

Skip any task whose behavior is already present (for example a persisted pre-send signature column).

## Tasks

1. Write the failing tests first in `tests/withdrawals-idempotency.test.js`: (a) a send that throws after the signature is known must not leave the row in a state that frees balance; (b) the same row processed twice (cron overlap or retry) issues exactly one transfer; (c) a `failed` row with a signature that is confirmed on chain is reconciled to `completed`; (d) a row whose signature is provably absent after blockhash expiry becomes `failed` and only then releases balance. Run them and confirm they fail for those reasons against current code.
2. Add a migration (`api/_lib/migrations/<timestamp>_withdrawal_send_idempotency.sql`, additive only) adding a nullable `send_signature` (or `tx_hash`), `send_attempted_at`, `last_valid_block_height` (Solana) and a state `broadcast_unconfirmed` to the status check if one exists. Read `npm run db:status` before `npm run db:migrate`; it applies immediately.
3. Change the payout path to: claim row with `UPDATE ... WHERE status='pending' ... RETURNING` (single winner), build and sign the transaction, persist the signature BEFORE broadcast, broadcast, then confirm. For Solana, use the persisted signature plus `lastValidBlockHeight` so retries rebroadcast or check status instead of building a new transfer. For EVM, persist the signed raw tx hash and nonce before send.
4. Replace the blanket catch-to-`failed` with classification: pre-broadcast failure -> `failed` (safe, nothing sent); post-broadcast or ambiguous failure -> `broadcast_unconfirmed` (still counted against balance).
5. Add a reconciler step in the same cron: for each `broadcast_unconfirmed` row, query `getSignatureStatuses` (Solana) or `eth_getTransactionReceipt` (EVM). Confirmed -> `completed`; blockhash/height expired and status null -> `failed` with a clear reason; otherwise leave for the next tick. Emit one structured log line per transition.
6. Update the balance computations in `api/monetization/withdrawals.js` and `api/billing/withdrawals/index.js` to include `broadcast_unconfirmed` in the reserved sum (extract one shared helper in `api/_lib/` so both use the same status list and a test pins it).
7. Surface the state honestly in any withdrawal list UI/API response (status label "confirming", with the signature link), and an operator alert (reuse the existing cron-alert mechanism) when a row stays `broadcast_unconfirmed` longer than 30 minutes.
8. Update `docs/financial-controls.md` to mark the gap closed with the commit-level evidence, and add a `data/changelog.json` entry.

## Definition of done

- [ ] `npx vitest run tests/withdrawals-idempotency.test.js` passes, and the tests demonstrably failed before the fix (note the failing output in the report).
- [ ] `grep -rn "broadcast_unconfirmed" api/monetization/withdrawals.js api/billing/withdrawals/index.js api/cron/\[name\].js` shows the state counted in both balance checks and handled in the cron.
- [ ] `npm run db:status` shows the new migration applied and no pending ones.
- [ ] A devnet (or simulated RPC) exercise of the ambiguous-failure path is recorded in the report: the row ends `completed` after reconcile with exactly one transfer.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No mainnet funds to test a real payout | Test against Solana devnet or a stubbed RPC at the web3 boundary only; never send mainnet funds in this order |
| Unsure whether a status check constraint exists | Read the migration that created the withdrawals table and extend it additively |
| Cron overlap hard to reproduce | Test the claim query directly with two concurrent invocations against the test database |

## Gates

Any real mainnet payout used for verification is a spend action: stop and ask once, batched at the end. The code and devnet tests do not need it.
