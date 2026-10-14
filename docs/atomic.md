# Atomic: Solana Transaction V1 lab

[Atomic](/atomic) is three.ws's read-only lab for Solana transactions: a tabbed flight recorder, size and budget planner, config mask decoder, legacy/V0/V1 diff, sponsor cap view, and wallet V1 capability check. The Inspector tab accepts either a confirmed mainnet signature or signed wire bytes and returns the same normalized inspection for legacy, V0, and V1 transactions; the other five tabs are documented below in "The lab: five more tools."

It is built for three jobs:

- Developers can see whether a payload needs V1's 4,096-byte envelope, and plan an exact byte budget before they build one.
- Wallets, relayers, and fee sponsors can read the limits they are actually agreeing to before they co-sign.
- Anyone can check whether their own wallet honestly advertises V1 signing before they rely on it.

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

## The lab: five more tools

`/atomic` is a tabbed lab, not a single tool. The Inspector above is the first tab; the other five share its read-only guarantee (nothing is ever signed, simulated, or broadcast) and are reachable by click, by arrow-key/Home/End navigation on the tab bar, or by a deep link: `/atomic?tab=mask`, `?tab=sponsor`, `?tab=planner`, `?tab=diff`, `?tab=wallet`.

### Config mask decoder

Every V1 transaction carries a 4-byte `TransactionConfigMask` (a little-endian `u32`) immediately after the version byte and legacy header, followed by fixed-width `ConfigValues` for each set bit. This tab decodes those exact bytes from a pasted signature or wire transaction, independently of the higher-level `budget` field the Inspector shows, and reports:

- the mask as hex, as a 32-character binary string, and as a bit popcount;
- each of the five known bits (priority fee spans bits 0-1 as one 8-byte value; compute unit limit, loaded accounts data size, and heap size each own one bit and one 4-byte value), whether it is present, and its raw bytes and decoded value;
- a priority-fee mask with only one of its two bits set, flagged as a partial, invalid encoding (SIMD-0385 requires both or neither);
- any set bit above bit 4, flagged as reserved, since a future SIMD may assign it a meaning this decoder does not yet know;
- the exact byte offset range `ConfigValues` occupies in the message.

A legacy or V0 transaction has no config mask; the tab states that plainly instead of showing an empty table.

### Sponsor cap view

A paymaster or co-signer reads this before it agrees to pay. For the same pasted signature or wire transaction, it shows only what a sponsor needs: the resolved priority fee, compute unit limit, loaded-accounts data size limit, and heap size (reading V1's `transactionConfig` directly, never a Compute Budget instruction scan that would see nothing on a V1 transaction), plus a duplicate-static-account check. SIMD-0385 makes a duplicate entry in the static address table a sanitization failure; this view lists any duplicate it finds and states plainly when there is none.

### Size and budget planner

Paste a fee payer address and a JSON array of instructions (`{programId, keys: [{pubkey, isSigner, isWritable}], data}`, `data` as base64 or a byte array), pick a target version, and optionally a compute unit limit, loaded-accounts data size limit, heap size, and priority fee in micro-lamports per CU. The planner compiles that exact instruction set with `@solana/kit`, the same encoder three.ws ships to real callers, and reports:

- the exact wire byte count, headroom or overage against the chosen version's ceiling, and a visual ruler;
- inline account count, instruction count, required signer count, and message byte count;
- the resolved resource budget, including the priority fee as an exact total in lamports (compute unit limit times the micro-lamports price, rounded up to the nearest lamport, matching the runtime's own cost accounting);
- the duplicate-static-account check described above.

"Load example instruction" fills the form with a System Program transfer using `$THREE`'s mint as a clearly-synthetic placeholder account; it is never auto-filled on page load.

### Legacy vs V0 vs V1 diff

Same form as the planner, minus the version picker: it compiles the identical instruction set three ways (legacy, V0, V1) and reports each version's exact byte count, ceiling, headroom, and fit side by side, plus the byte delta V1 saves (or costs) against legacy and against V0. V1 is not assumed to always win: its inline config mask and fixed-width values can make a very small transaction larger than the same payload on legacy or V0, and the diff reports whichever is actually true for the pasted instructions.

### Wallet V1 capability check

Connects the browser's injected Solana wallet (a plain `connect()`, with no SIWS account-linking and no three.ws login as a side effect) and reads its real [Wallet Standard](https://github.com/wallet-standard/wallet-standard) `solana:signTransaction` feature. The pass/fail verdict comes from the same `findV1WalletStandardSigner` helper three.ws calls before it ever asks a wallet for a real V1 signature, so this tab reports exactly what the rest of the platform would see, not a separate approximation. If the wallet is V1-capable, the tab also lists every transaction version its own feature set advertises, verbatim.

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

### Size and budget plan

```http
POST /api/solana/atomic-plan
Content-Type: application/json

{
  "feePayer": "BASE58_ADDRESS",
  "version": 1,
  "budgetConfig": { "computeUnitLimit": 200000, "loadedAccountsDataSizeLimit": 4096, "priorityFeeMicroLamportsPerCu": 10 },
  "instructions": [
    { "programId": "11111111111111111111111111111111", "keys": [{ "pubkey": "BASE58_ADDRESS", "isSigner": true, "isWritable": true }], "data": "BASE64_DATA" }
  ]
}
```

`version` is `"legacy"`, `0`, or `1`. `budgetConfig` and each of its fields are optional. Every reported number comes from compiling and encoding this exact instruction set with `@solana/kit`; nothing is estimated, signed, simulated, or broadcast. The handler is rate-limited the same way as `/api/solana/atomic` and caps the request body at 64 KiB and 64 instructions.

### Legacy vs V0 vs V1 diff

Same endpoint, with `"diff": true` in place of `version`:

```http
POST /api/solana/atomic-plan
Content-Type: application/json

{ "feePayer": "BASE58_ADDRESS", "diff": true, "budgetConfig": {}, "instructions": [ ... ] }
```

The response is `{ "diff": { "legacy", "v0", "v1", "bytesSavedVsLegacy", "bytesSavedVsV0" } }`, one plan object per version plus the byte deltas between them.

## Platform compatibility

Every three.ws Solana transaction read now opts into version 1. The web app and API dependency floor is `@solana/kit` 8.3 and `@solana/web3.js` 1.99, so direct readers can decode V1 rather than rejecting it as an unsupported transaction version.

New senders should use `@solana/kit` 8 or later, build with `createTransactionMessage({ version: 1 })`, set the transaction config explicitly, check wallet V1 capability, and only then request a signature.

## Sources

- [Solana Transaction V1 guide](https://solana.com/docs/core/transactions/versioned-transactions)
- [SIMD-0385: Transaction V1 format](https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0385-transaction-v1.md)
- [SIMD-0296: larger transactions](https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0296-larger-transactions.md)
- [Runnable V1 examples](https://github.com/solana-foundation/transaction-v1-examples)
