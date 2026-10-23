# x402 v2 `upto` on Solana

`upto` lets a buyer authorize a ceiling and pay only for what the call used. The seller declares a cap, runs the work, measures the charge, and settles that amount. The unused part of the escrowed deposit goes back to the buyer. A handler that throws settles nothing: the whole deposit is refunded.

three.ws runs the `upto` facilitator in-process. It uses the sponsor key that already backs the `exact` self-facilitator (`X402_FEE_PAYER_SECRET_BASE58`) as the transaction fee payer and as the channel's receiver authorizer, so no third-party facilitator has to support `upto`. All signing is done by the official `@x402/svm` (>= 2.28) client, server and facilitator schemes; nothing in this repo hand-rolls a payment signature.

## How a call flows

1. **402.** The challenge lists the usual `exact` accepts and one extra accept: `{ scheme: "upto", amount: <cap>, extra: { feePayer, receiverAuthorizer, withdrawDelay, tokenProgram, ... } }`.
2. **Buyer signs.** The `upto` client scheme signs a payment-channel `open` transaction that deposits the cap. The payload carries the transaction, not a transfer.
3. **Verify.** `x402-spec.js` runs the facilitator verify: program, deposit equals cap, payee, fee payer, simulation.
4. **Deposit settles before the handler.** The cap is escrowed on chain first, so the seller never does work it cannot collect. If the deposit fails, the handler does not run.
5. **Handler runs, charge is measured.** `upto.charge({ req, result, requirement, payer })` returns the atomic amount used (bigint, number or string). It is clamped to `0..cap`.
6. **Claim settles.** The requirement amount becomes the measured charge and the server signs a voucher for that cumulative amount. The program pays the seller the charge and refunds the rest.
7. **Cancel.** If the handler throws, or the charge hook fails, a claim of `0` is submitted and the whole deposit returns to the buyer.

Receipts, spend ledgers, `onSettled`, SIWX grants and the signed offer-receipt all read the charge from the settled requirement, so they record what was actually paid. An `upto` call that measured `0` charged nothing and earns no SIWX session.

## Seller

```js
export default paidEndpoint({
  route: '/api/x402/llm-proxy',
  priceAtomics: '5000',
  upto: {
    capAtomics: 25000n,
    charge: ({ result }) => BigInt(result.tokens_used) * 5n,
  },
  handler: async ({ req }) => { /* ... */ },
});
```

`upto` is additive: the `exact` accepts stay in the challenge, so existing clients keep working unchanged. It is advertised only when the deployment opts in (`X402_UPTO_ENABLED=true`, plus the sponsor key and `X402_PAY_TO_SOLANA` / `X402_ASSET_MINT_SOLANA`). It cannot be combined with `streaming` (the body would ship before the charge is known). `api/x402/llm-proxy.js` is the first route converted: 5 atomics per token, at least 500, capped at five times the flat price.

SIWX is a poor fit for per-call metered routes (a returning wallet is served without paying again), so the llm-proxy route does not enable it. A fixed-price or time-boxed `upto` route can set `siwx` normally.

## Buyer

`buildSolanaUptoPayload` in `api/_lib/x402/a2a-client.js` builds the payload with the official client scheme. It checks the offered cap against the agent's `maxPerCallAtomics` before anything is signed and throws `cap_exceeds_limit` when the cap is higher, exactly as the spending-cap layer treats an `exact` price. `x402-buyer-fetch.js` accepts `preferScheme: 'upto'` and releases the unused part of the reserved cap (`releaseUnusedCap`) after the claim lands, so a 25,000-atomic cap that settled 500 only counts 500 against the daily budget.

## Extensions

- **sign-in-with-x** works unchanged on `upto` routes that opt in with `siwx`. The grant is recorded from the charged amount.
- **offer-receipt**: the 402 carries a signed offer per accept (including the `upto` one) and the paid response carries a signed receipt for the measured charge when `OFFER_RECEIPT_SIGNING_PRIVATE_KEY` is configured. Buyers store it in the receipts ledger as before.

## Operating notes and limits

- Channel state is in the facilitator's in-memory store. A crash between the deposit and the claim leaves the channel open until the payer's `withdrawDelay` (900 s) elapses; the payer can then withdraw the deposit. Nothing is lost, but the seller forfeits that call's revenue.
- The sponsor key doubles as voucher signer. Keep it out of any `X402_PAY_TO_*` wallet and rotate it like the other sponsor secrets.
- The offered `maxTimeoutSeconds` is 600; the facilitator refuses channels that live longer than 3600 s.

## Batch settlement: finding

`@x402/svm` 2.28.0 ships `batch-settlement/{client,server,facilitator}`, so this is not a missing-package gap. What `batch-settlement` needs that `upto` does not:

1. A **durable voucher store**. The package exports only `MemoryBatchOperationStore`; vouchers are worth nothing until claimed, so losing the process loses revenue. A Postgres-backed `BatchOperationStore` plus a migration is required.
2. A **redemption worker**. `BatchSvmScheme.createChannelManager(...)` claims accumulated vouchers and distributes what settles, and must run on a schedule well inside the forced-close grace period (a Cloud Scheduler cron).
3. **Wiring the scheme's lifecycle hooks into `paidEndpoint`**: pre-settle (commit voucher charges for steady-state requests), post-settle (finalize deposits and refunds), and the abort and cancel hooks that drop reservations.
4. An **on-chain run**. The claim and distribute transactions can only be proven against a funded cluster; the local facilitator in `tests/helpers/` cannot stand in for them.

`upto` ships first because it needs none of that state. The `upto` spec option and the deposit-before-handler and cancel paths in `x402-paid-endpoint.js` are the template for the batch hooks.

## Tests

`tests/x402-upto.test.js` drives `paidEndpoint()` end to end with the real `upto` client and server schemes. The facilitator (`tests/helpers/upto-local-facilitator.js`) is test-controlled and replaces only the chain with an in-memory ledger; the buyer's ed25519 signature over the open transaction and the server's ed25519 voucher are both verified for real. Cases: the 402 shape, partial settlement and refund, a throwing handler settling nothing, clamping above the cap, a tampered deposit, the buyer cap refusal, and the offer-receipt on the paid response.

A real on-chain check needs funded wallets and is run by the owner; the commands are in the work-order close-out.
