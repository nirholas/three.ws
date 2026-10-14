# Atomic: Solana Transaction V1 inspector

[Atomic](/atomic) is three.ws's read-only flight recorder for Solana transactions. It accepts either a confirmed mainnet signature or signed wire bytes and returns the same normalized inspection for legacy, V0, and V1 transactions.

It is built for two jobs:

- Developers can see whether a payload needs V1's 4,096-byte envelope.
- Wallets, relayers, and fee sponsors can read the limits they are actually agreeing to before they co-sign.

Atomic never signs, simulates, or broadcasts a transaction.

## What changed in V1

Legacy and V0 transactions are limited to 1,232 bytes. V1 raises the ceiling to 4,096 bytes and puts the version discriminator at byte zero (`0x81`). V1 does not use address lookup tables.

The important security change is the resource budget. Legacy and V0 carry limits in Compute Budget program instructions. V1 carries them in `transactionConfig` at fixed positions in the message. A sponsor that keeps scanning Compute Budget instructions sees no effective cap on a V1 transaction.

V1 also makes two limits explicit:

- `computeUnitLimit`
- `loadedAccountsDataSizeLimit`

Their V1 defaults are zero. A V1 sender must set both for a transaction that executes and loads account data. Heap size retains its 32 KiB default, and a priority fee remains optional.

## Inspect a confirmed transaction

Open `/atomic`, leave **On-chain signature** selected, and paste a Solana mainnet transaction signature. The report shows:

- exact signed wire size and headroom;
- whether it crosses the old 1,232-byte wall;
- transaction version, signature count, inline accounts, and instruction count;
- normalized compute, account-data, heap, and priority-fee limits;
- confirmed compute consumption when the RPC supplies it;
- a sponsor assessment that calls out missing V1 limits.

The signature is stored in the page URL, so the inspection can be shared.

## Inspect a handoff before co-signing

Select **Base64 wire** and paste the base64 string passed between a builder, wallet, relayer, facilitator, or paymaster. The API decodes it without contacting an RPC.

```bash
curl https://three.ws/api/solana/atomic \
  -H 'content-type: application/json' \
  -d '{"transaction":"BASE64_SIGNED_TRANSACTION"}'
```

The response is JSON-safe. Priority fees and other wide integers are returned as numbers when they fit safely, otherwise as decimal strings.

## Replay: pump.fun lifecycle events

When a confirmed transaction invoked Pump, PumpSwap, or PumpFees, Atomic decodes every typed event in its logs, oldest first, and the page renders them as a step-by-step **Replay**: a curve-position bar, a human-readable description of each step, and the SOL/token amounts that moved.

The decoder covers a coin's full lifecycle:

- `create`: a new bonding curve launches.
- `trade`: a buy or sell against the bonding curve, with the post-trade curve-fill percentage.
- `complete`: the curve graduates; liquidity migrates to PumpSwap.
- `ammBuy` / `ammSell`: a swap against the graduated PumpSwap pool.
- `collectCreatorFee` / `distributeCreatorFees`: creator-fee collection and its split across shareholders.
- `socialFeePdaClaimed`: a GitHub social-fee PDA claim.

An event whose 8-byte discriminator is not in the installed `@nirholas/pump-sdk`'s IDLs (a program upgrade this install predates) still renders, as `unrecognized`, with its raw program ID and bytes. The replay never silently drops a step.

For a `create` transaction, the response also carries `replay`: the earliest trades on that mint since launch. Solana's `getSignaturesForAddress` has no forward cursor, only a `before` cursor walking backward from "now," so the server walks backward in capped pages (5 pages of 1,000 signatures) looking for the create signature, then returns the trades between it and the oldest page reached. A caller that gets `hasMore: true` back pages deeper with the returned `nextBefore`; the page's "Load earlier trades" button does this automatically.

Try it against a real $THREE trade:

```bash
curl https://three.ws/api/solana/atomic \
  -H 'content-type: application/json' \
  -d '{"signature":"3mmfm7wj9CtC5QutckLKvYQZDhQcaVBrbYD8sZFwKHW7efN9E3ETz9yMeMNfYw8coodpNfYzpM6wfzr5RUf1CYo"}'
```

$THREE graduated its bonding curve some time ago, so this particular signature decodes as PumpSwap AMM events (`ammInitUserVolumeAccumulator`, `ammBuy`, `ammCloseUserVolumeAccumulator`) rather than bonding-curve `trade` events; both shapes render in the same Replay panel. AMM buy/sell events carry a `pool` address but no `mint` field in the installed IDL, so the panel's "View launch" link only appears when the transaction includes a bonding-curve event (`create`, `trade`, or `complete`), which does carry one.

A transaction with no pump.fun events (most Solana transactions) shows a plain "no pump.fun events in this transaction" state instead of an empty panel.

## API

### Mainnet activation status

```bash
curl https://three.ws/api/solana/atomic
```

This reads the `txv1` feature account and the current confirmed slot through the rotating three.ws RPC rail. The response includes the activation slot and both wire limits.

### Confirmed signature

```bash
curl 'https://three.ws/api/solana/atomic?signature=SOLANA_SIGNATURE'
```

The RPC request always passes `maxSupportedTransactionVersion: 1`. Confirmed results are cached because their wire bytes and metadata are immutable. The response also carries `events` (every decoded pump.fun event in the transaction, see Replay above) and, for a create transaction, `replay`. `before` and `tradeLimit` query params page a create transaction's `replay.trades` deeper; a response that passed `before` is never cached.

### Raw transaction

```http
POST /api/solana/atomic
Content-Type: application/json

{ "transaction": "BASE64_SIGNED_TRANSACTION" }
```

The raw path is not cached and does not send the transaction to Solana.

## Platform compatibility

Every three.ws Solana transaction read now opts into version 1. The web app and API dependency floor is `@solana/kit` 8.3 and `@solana/web3.js` 1.99, so direct readers can decode V1 rather than rejecting it as an unsupported transaction version.

New senders should use `@solana/kit` 8 or later, build with `createTransactionMessage({ version: 1 })`, set the transaction config explicitly, check wallet V1 capability, and only then request a signature.

## Sources

- [Solana Transaction V1 guide](https://solana.com/docs/core/transactions/versioned-transactions)
- [SIMD-0385: Transaction V1 format](https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0385-transaction-v1.md)
- [SIMD-0296: larger transactions](https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0296-larger-transactions.md)
- [Runnable V1 examples](https://github.com/solana-foundation/transaction-v1-examples)
