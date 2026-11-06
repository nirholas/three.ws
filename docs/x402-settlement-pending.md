# Pending settlement: the third answer an x402 settle can give

An x402 payment has three moving parts: the 402 challenge, the buyer's signed
payment, and the settlement that puts that payment on chain. For most of x402's
short life the last step had two possible outcomes, success or failure, and that
is one outcome short of the truth.

A Solana transaction is broadcast and then confirmed. Those are separate events
seconds apart, and between them the outcome is genuinely unknown: the transaction
may be about to land, may already have landed on a node that has not answered
yet, or may have been dropped. A settle that has to answer immediately has to
guess, and the old answer was "failed".

That guess is expensive in both directions. Report failure and a buyer whose
USDC is about to move is told they were not charged and handed no product. Report
success and you have promised a settlement that may never happen.

Since 2026-09-17 the Solana x402 facilitators, ours included, answer with a third
state instead:

```json
{
  "success": false,
  "errorReason": "settlement_pending",
  "transaction": "5Kd...a1c"
}
```

Read it as: **broadcast, outcome unknown, ask again.** It is not a failure, and
the canonical SDKs treat it as retryable rather than surfacing it as an error.
This page documents how three.ws implements it on both sides of the wire.

## What changes for you as a buyer

Nothing, if you use a current x402 client library: `@x402/fetch`, `@x402/axios`,
`@x402/mcp` and the Go server retry a pending settle for you.

If you speak the protocol by hand, two rules:

1. **Do not treat `settlement_pending` as a failed payment.** Retry the settle
   with the *identical* payload, requirements, and `Idempotency-Key`. That
   identity is what lets the facilitator recognise your retry and reconcile
   against the transaction it already broadcast. A changed key or payload asks it
   to verify and broadcast a second transaction, which is how an unknown outcome
   turns into a double charge.
2. **Retry once, then read the response.** Our paid endpoints deliver the good
   on a pending settlement and tell you so in the `X-PAYMENT-RESPONSE` header:

   ```json
   { "success": true, "status": "pending", "transaction": "5Kd...a1c", "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "payer": "..." }
   ```

   `status: "pending"` means your response body is real and complete, and the
   settlement is still confirming. `transaction` is the signature to watch on any
   Solana explorer. You do not need to pay again, and you must not: the
   authorization you signed is single-use and already spent.

Every other settle response is unchanged. A settle that genuinely failed still
says so, with a reason you can act on.

## What it does on our rail

### The facilitator: never guess, never re-broadcast

[`self-facilitator.js`](../api/_lib/x402/self-facilitator.js) settles Solana
payments in house: it validates the buyer-signed transfer, co-signs the fee
payer, broadcasts over our own RPC, and waits for confirmation. It is a thin
platform adapter (Postgres store, fee meter, env wiring) over the
`createFacilitator()` code published as
[`@three-ws/x402-server/facilitator`](../packages/x402-server/README.md), where
the confirmation logic lives. The wait now distinguishes three answers rather
than two.

| Chain says | Verdict | Response |
| --- | --- | --- |
| Landed, no error | confirmed | `success: true` |
| Landed with an on-chain error | terminal failure | `success: false`, `not_confirmed:<err>` |
| Dropped: blockhash expired, never observable | terminal failure | `success: false`, `abandoned` at reconcile |
| Wait ran out, or the RPC could not answer | **unknown** | `settlement_pending` + signature |

Only the last row is pending. A transaction that ran and reverted is a failure
and always was; an RPC that returns 429 tells you nothing about a transaction and
must never be read as a rejection. That distinction is the whole mechanism: if
"unknown" is allowed to absorb real failures, pending becomes a way of never
answering.

A pending answer also carries an obligation, so the facilitator records the
broadcast signature *before* it answers, keyed by a hash of the signed
transaction. Two things follow:

- **A retry reconciles instead of re-broadcasting.** A settle whose payload
  matches a recorded signature skips validation, balance reads, fee metering,
  co-signing and broadcast entirely, and simply re-awaits that signature. One
  authorization produces one transaction, ever.
- **A pending answer that cannot be recorded is downgraded to a failure.**
  Answering pending promises that a retry can reconcile, and with no record it
  cannot. The reason becomes `settlement_pending_unrecordable` and still carries
  the signature, so the payment can be reconciled by hand.

The store lives in Postgres
([`pending-settlements.js`](../api/_lib/x402/pending-settlements.js)), not in
process memory. The x402 SDK's default `PendingSettlementStore` is a per-process
`Map`, which only works when the retry happens to land on the same instance; our
API runs several Cloud Run replicas with no session affinity, so an in-memory
store would miss most retries and re-broadcast instead of reconciling. This is
exactly the case the SDK made the store an interface for.

### The resource server: deliver, then finish the accounting

[`settlePayment`](../api/_lib/x402-spec.js) retries a pending settle exactly
once, with the same body and key. If the retry resolves, the payment is ordinary.
If it does not, the settle returns `status: 'pending'` rather than throwing, the
endpoint delivers the good, and the row is handed to reconciliation.

Exactly one retry, never a loop: this runs inside a buyer's open HTTP request,
and any bounded waiting belongs to the facilitator's own confirmation window.

Delivering against an unconfirmed payment is a deliberate trade, and it is
bounded by two things. The payment was simulated at `/verify` before the handler
ran (a payment that cannot settle never reaches the work), and the settlement is
already broadcast, so the overwhelming majority land within seconds. What makes
the trade acceptable rather than reckless is that it is never silent: the
settlement credit is not claimed, the SOL fee is not metered, and the payment is
recorded with `settlement_status = 'pending'` (so revenue queries, which count
`success`, do not include it) until the chain answers.

One thing does fire on a pending settlement: a route's own post-settlement
accrual hook, such as the author royalty on `/api/x402/skill-call`. That is
deliberate, so an author is paid promptly rather than on the reconcile cadence,
and every accrual carries the settlement signature as provenance, so the rare
abandoned settlement can be traced to the accrual it produced.

### Reconciliation: the books close either way

[`/api/cron/x402-settlement-reconcile`](../api/cron/x402-settlement-reconcile.js)
runs every two minutes over the open rows. It is strictly read-only on chain: it
never signs and never re-sends.

- **Confirmed** → claim the settle credit under the same idempotency key the
  settle used, so [`settle-credit.js`](../api/_lib/x402/settle-credit.js) grants
  it at most once per signature, with the fee the chain actually charged, and
  promote the payment's audit row from `pending` to `success` so it enters the
  revenue figures.
- **Failed or abandoned** → close the row and mark the audit row `failed`. If
  the good had already been delivered, raise an ops alert naming the signature,
  the resource, and the payer. This is the one case the design can cost us, so it
  is never quiet.
- **Still unknown** → bump the attempt count and look again next pass. A
  signature the ledger has never seen is only written off once its blockhash can
  no longer be valid (180s), because before that "not found" means "not yet".

Resolved rows are pruned after 30 days by the storage sweep; an unresolved one is
never pruned, because it is a payment nobody has accounted for yet.

`GET /api/x402-status` reports the live picture under `settlements`:

```json
{ "settlements": { "window_hours": 24, "pending": 0, "confirmed": 141, "failed": 0, "abandoned": 0 } }
```

A non-zero `pending` is normal and self-clearing. A climbing `pending` with
`abandoned` or `failed` beside it is not a payment problem: it means settlements
are being broadcast into conditions where they cannot confirm, which points at
RPC health or a sponsor wallet that cannot cover fees.

## Latency, which is the other half of the story

The old confirmation wait was 30 seconds, because a wait that ran out became a
502 and a 502 had to be avoided at almost any cost. Once an unresolved wait is a
third outcome instead of a failure, holding a buyer's connection open that long
buys nothing. The wait is now 12 seconds with an 800ms poll, which clears the
overwhelming majority of confirmations inline and caps the settle leg of a paid
request at a latency a client library will sit through. Anything slower goes
pending and finishes out of band.

Operators can move it without a deploy:

```bash
# Shorter wait: more settles go pending, each request returns sooner. Useful
# while an RPC provider is degraded.
gcloud run services update three-ws-api --region us-central1 \
  --update-env-vars X402_SETTLE_CONFIRM_TIMEOUT_MS=6000
```

## Why this matters beyond one status string

The binary was not just imprecise, it was the single largest source of false
failure on the rail. `not_confirmed:confirm_timeout` was reported as a settle
failure and answered with 502, which every buyer, every trust monitor, and every
one of our own pipelines read as a broken endpoint, on payments the chain was in
the middle of accepting. The third state does not make settlement more reliable;
it makes our report of it true.

## Related

- [Closed-loop x402 ring economy](./x402-ring-economy.md): the self-hosted
  facilitator, the SOL runway governors, and the one-signature-one-payment gate
  the reconcile pass claims credit through
- [x402 buyer guide](./x402-buyer.md): paying our endpoints from your own agent
- [x402 developer tools](./x402-dev-tools.md): free bench for debugging a 402
  exchange, including a failed settle
- [x402 paid endpoints](./x402-endpoints.md): the catalog of what you can pay for
