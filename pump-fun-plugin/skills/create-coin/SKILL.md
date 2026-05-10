---
name: create-coin
description: >
  Create coins on pump.fun — standard create with initial buy. Prefer runnable
  Node scripts in this skill folder; use @pump-fun/pump-sdk for custom
  integrations.
metadata:
  author: pump-fun
  version: "1.0"
---

# Before Starting Work **Critical** - Ask these from user

**MANDATORY — Do NOT write or modify any code until every item below is answered by the user:**

- [ ] RPC URL provided or a fallback agreed upon (for any on-chain or tx-building step)
- [ ] **Signer wallet** public key (fee payer / creator)
- [ ] Framework confirmed (Next.js, Express, CLI scripts only, other)
- [ ] Coin name, symbol, and metadata URI (or plan to upload) confirmed — see [references/METADATA.md](references/METADATA.md)
- [ ] Initial buy amount confirmed (SOL in lamports)
- [ ] Cashback desired? (default off)
- [ ] Mayhem mode desired? (default off)
- [ ] Tokenized agent desired? (default off), If Yes then with what Buyback percentage.
- [ ] Front-runner protection desired? If yes, confirm tip amount (default 0.0001 SOL). Transactions will be sent **only** to Jito block engine endpoints.

You MUST ask the user for ALL unchecked items in your very first response. Do not assume defaults. Do not proceed until the user has explicitly answered each one.

## API (preferred) — `https://fun-block.pump.fun`

Use the API to build transactions instead of running scripts directly. The API handles account resolution, compute budget, and partial signing automatically.

### `POST /agents/create-coin`

Builds a create + initial buy transaction. The server generates a mint keypair and partial-signs with it. The client wallet co-signs and submits.

**Request body:**

```json
{
  "user": "<PUBKEY>",
  "name": "MyCoin",
  "symbol": "MC",
  "uri": "https://ipfs.io/ipfs/Qm...",
  "solLamports": "1000000",
  "mayhemMode": false,
  "cashback": false,
  "tokenizedAgent": false,
  "buybackBps": 5000,
  "frontRunningProtection": false,
  "tipAmount": 0,
  "encoding": "base64",
  "feePayer": "<PUBKEY>",
  "creator": "<PUBKEY>"
}
```

Only `user`, `name`, `symbol`, `uri`, and `solLamports` are required. All other fields are optional with sensible defaults.

> **`tipAmount`** is a Jito tip in **SOL** (e.g. `0.0001` for 100,000 lamports). Only relevant when `frontRunningProtection` is `true`.

> **Encoding:** The API defaults to `"base58"` encoding. **Always pass `"encoding": "base64"`** in the request body — scripts already output base64. When sending the signed transaction to an RPC or Jito endpoint, the encoding used to serialize the transaction must match the `encoding` parameter passed in the send call. Mismatched encodings will cause transaction failures. **Always** explicitly pass `encoding: "base64"` in `sendTransaction` / `simulateTransaction` RPC calls — never rely on the RPC's default.

**Response:**

```json
{
  "transaction": "<base64-encoded VersionedTransaction>",
  "mintPublicKey": "<base58 mint address>",
  "quoteTokenAmount": "123456789",
  "solLamports": "1000000",
  "mayhemMode": false,
  "cashback": false,
  "tokenizedAgent": false
}
```

The returned `transaction` is already partial-signed with the mint keypair. Deserialize it, have the user wallet sign, and submit to chain.

## Runnable examples (Node scripts — only when user explicitly requests)

Use **`{baseDir}`** as the path to this skill folder (OpenClaw and Agent Skills clients often expose this placeholder).

```bash
cd {baseDir}
npm install
export SOLANA_RPC_URL=https://rpc.solanatracker.io/public
```

| Operation                                | Script                               | Example                                                                                                                                                                                                                                                                  |
| ---------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fetch coin state (HTTP)                  | `scripts/fetch-coin.mjs`             | `node scripts/fetch-coin.mjs --mint <MINT> --subset`                                                                                                                                                                                                                     |
| Create + initial buy (partial-sign mint) | `scripts/build-create-coin-tx.mjs`   | `node scripts/build-create-coin-tx.mjs --user <PUBKEY> --name "Coin" --symbol "CN" --metadata-uri <URI> --sol-lamports 1000000 --mint-keypair-out ./mint.json [--mayhem-mode] [--cashback] [--tokenized-agent --buyback-bps 5000] [--alt-address <PUBKEY>]`               |

- Run any script with `--help` for full flags (`--mayhem-mode`, `--tokenized-agent`, `--buyback-bps`, `--compute-units`, `--priority-micro-lamports`, `--front-runner-protection`, `--tip-sol`, etc.).
- Tx builders print **one JSON object** on stdout with `transaction` (base64-encoded VersionedTransaction, partially signed when the mint keypair is used on create). **Never** pass end-user private keys into these scripts.
- **OpenClaw:** If YAML `metadata` ever fails to parse, collapse `metadata` to a single-line JSON object per [OpenClaw skills](https://docs.openclaw.ai/skills/); optional `metadata.openclaw.requires.env: ["SOLANA_RPC_URL"]` can gate load-time eligibility.

**Published copy:** [METADATA.md (raw)](https://raw.githubusercontent.com/pump-fun/pump-fun-skills/refs/heads/main/create-coin/references/METADATA.md)

## Safety Rules

- **NEVER** log, print, or return private keys or secret key material.
- **NEVER** sign transactions on behalf of a user — scripts build txs; the user (or their wallet) co-signs and sends.
- Always validate that amounts are `> 0` before building instructions.
- Use the correct decimal precision: **9 decimals for SOL** (1 SOL = 1,000,000,000 lamports), **6 decimals for pump tokens**.
- **NEVER trust `token_program` from the HTTP API** (`coins-v2`). Always fetch the mint account on-chain via `connection.getAccountInfo(mint)` and use `.owner` to determine the correct token program (SPL Token or Token-2022).
- **Verify imports:** use `@pump-fun/pump-sdk` (not internal monorepo paths). In TypeScript apps, `BN` from `bn.js` matches what the SDKs expect (Anchor `BN` is the same type in practice).

## Program IDs

| Program | ID                                            |
| ------- | --------------------------------------------- |
| Pump    | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` |

## Environment Variables

```env
SOLANA_RPC_URL=https://rpc.solanatracker.io/public
NEXT_PUBLIC_SOLANA_RPC_URL=https://rpc.solanatracker.io/public
```

The default public mainnet RPC (`https://api.mainnet-beta.solana.com`) often **cannot send** transactions. Confirm an HTTPS RPC with the user. Examples: Solana Tracker public RPC, Ankr `https://rpc.ankr.com/solana`.

## Install

**Inside this skill folder** (includes scripts):

```bash
cd {baseDir}
npm install
```

**Inside another app** (from scratch):

```bash
npm install @pump-fun/pump-sdk @pump-fun/agent-payments-sdk @solana/web3.js@^1.98.0 @solana/spl-token bn.js
```

Check `npm info @pump-fun/pump-sdk dependencies` and align `@solana/web3.js` / `@solana/spl-token` versions to avoid duplicate incompatible copies.

## SDK setup (minimal)

```typescript
import { PUMP_SDK, OnlinePumpSdk } from "@pump-fun/pump-sdk";
import { Connection } from "@solana/web3.js";

const connection = new Connection(process.env.SOLANA_RPC_URL!);
const onlinePump = new OnlinePumpSdk(connection);
```

Full transaction building (compute budget, blockhash, partial sign) is implemented in `scripts/lib/tx-build.mjs` and `scripts/lib/compute.mjs`.

## Create a coin

- **Default:** `POST /agents/create-coin` (see API section above)
- **Script (only when user explicitly requests):** `scripts/build-create-coin-tx.mjs`
- **Metadata JSON:** [references/METADATA.md](references/METADATA.md)

### Parameters (`createV2AndBuyInstructions`)

| Parameter    | Type        | Description                                                            |
| ------------ | ----------- | ---------------------------------------------------------------------- |
| `global`     | `Global`    | From `OnlinePumpSdk.fetchGlobal()`                                     |
| `mint`       | `PublicKey` | New mint (generated keypair)                                           |
| `name`       | `string`    | Coin name                                                              |
| `symbol`     | `string`    | Ticker                                                                 |
| `uri`        | `string`    | Metadata JSON URL                                                      |
| `creator`    | `PublicKey` | Creator                                                                |
| `user`       | `PublicKey` | Payer (often same as creator)                                          |
| `amount`     | `BN`        | Token amount to buy (6 decimals)                                       |
| `solAmount`  | `BN`        | SOL for initial buy (lamports)                                         |
| `mayhemMode` | `boolean`   | Configurable via `--mayhem-mode` flag (default: `false`)               |
| `cashback`   | `boolean`   | Enable cashback rewards; optional, default `false`                     |

When `--tokenized-agent` is enabled, an additional `PumpAgentOffline.load(mint).create(...)` instruction (from `@pump-fun/agent-payments-sdk`) is appended after the create+buy instructions. The `--buyback-bps` flag controls the agent buyback percentage in basis points (default: 5000 = 50%). Tokenized agent coins **must** have an initial buy > 0 SOL.

Token amount for the initial buy is derived with `getBuyTokenAmountFromSolAmount` (`mintSupply: null`, `bondingCurve: null`).

## Compute units and priority fees

Defaults match the pump.fun app constants (see `scripts/lib/constants.mjs` in this skill):

| Operation                          | Default compute units                        |
| ---------------------------------- | -------------------------------------------- |
| Create + buy                       | 270_000 + 120_000 = **390_000**              |
| Create + buy + tokenized agent     | 270_000 + 120_000 + 30_000 = **420_000**     |

Scripts accept `--compute-units` to override. When `--tokenized-agent` is enabled, 30,000 extra units are added automatically.

**Priority fee:** If `--priority-micro-lamports` is omitted, scripts call Solana JSON-RPC `getPriorityFeeEstimate` on a draft serialized transaction (with a 100k microlamport floor and an upper cap — see `scripts/lib/compute.mjs`), matching the pattern in `useFrontendCreateCoin`. Many RPCs support this; if not, the floor is used.

## Transaction assembly and send

After the user wallet signs, choose the send path based on whether `frontRunnerProtection` is `true` in the script output JSON.

### Default (no front-runner protection)

```typescript
const signature = await connection.sendRawTransaction(
  signedTransaction.serialize(),
  { skipPreflight: false, preflightCommitment: "confirmed" },
);
const latestBlockhash = await connection.getLatestBlockhash("confirmed");
await connection.confirmTransaction(
  { signature, ...latestBlockhash },
  "confirmed",
);
```

### With front-runner protection (Jito only)

When the transaction was built with `--front-runner-protection`, it already contains a Jito tip instruction. Send it **only** to Jito block engine endpoints — do **not** send via `connection.sendRawTransaction` or any other RPC, as that would leak the transaction to the public mempool and defeat the protection.

```typescript
import { sendTransactionToJito } from "./lib/jito.mjs";

const txBase64 = Buffer.from(signedTransaction.serialize()).toString("base64");
const result = await sendTransactionToJito(txBase64);
```

Or manually via `fetch` (no dependency on the lib):

```typescript
const JITO_ENDPOINTS = [
  "https://mainnet.block-engine.jito.wtf/api/v1/transactions",
  "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/transactions",
  "https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/transactions",
  "https://ny.mainnet.block-engine.jito.wtf/api/v1/transactions",
  "https://tokyo.mainnet.block-engine.jito.wtf/api/v1/transactions",
];

const txBase64 = Buffer.from(signedTransaction.serialize()).toString("base64");
const body = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "sendTransaction",
  params: [txBase64, { encoding: "base64" }],
});

await Promise.any(
  JITO_ENDPOINTS.map((url) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }).then((r) => r.json()),
  ),
);
```

Then confirm as usual with `connection.confirmTransaction`.

## Get coin data (HTTP)

`GET https://frontend-api-v3.pump.fun/coins-v2/{mint}`

> **CORS-protected:** `frontend-api-v3.pump.fun` does not allow browser-origin requests. When building a web application, always call this endpoint from your backend/server and proxy the result to the frontend. Do not call it directly from client-side JavaScript.

```json
{
  "mint": "ABcDeFgHiJkLmNoPqRsTuVwXyZ123456789abcdefg",
  "name": "MyToken",
  "symbol": "MTK",
  "description": "A sample token on pump.fun",
  "image_uri": "https://ipfs.io/ipfs/Qm...",
  "metadata_uri": "https://ipfs.io/ipfs/Qm...",
  "creator": "CreatorWalletAddress...",
  "created_timestamp": 1700000000,
  "complete": false,
  "bonding_curve": "BondingCurveAddress...",
  "associated_bonding_curve": "AssociatedBondingCurveAddress...",
  "pump_swap_pool": null,
  "token_program": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "market_cap": 25000000000,
  "usd_market_cap": 50000,
  "virtual_sol_reserves": "30000000000",
  "virtual_token_reserves": "1073000000000000",
  "total_supply": "1000000000000000",
  "raydium_pool": "",
  "program": "pump",
  "reply_count": 42,
  "last_trade_timestamp": 1700086400
}
```

> **NEVER trust `token_program` from the HTTP API.** The `coins-v2` endpoint may return a stale or incorrect `token_program`. Always resolve it on-chain by fetching the mint account and reading its owner:
>
> ```typescript
> const mintAccountInfo = await connection.getAccountInfo(mintPublicKey);
> const tokenProgram = mintAccountInfo.owner; // TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID
> ```
>
> The skill scripts already do this via `tokenProgramIdFromMint()` in `scripts/lib/coin-resolve.mjs`. Any custom integration **must** do the same.

## Error handling and troubleshooting

- **Bonding curve account missing** — wrong mint, wrong network, or coin not yet created on-chain.
- **Insufficient SOL** — user cannot pay rent, buy amount, or fees; check balance before building.
- **Slippage / simulation failures** — retry with fresh blockhash (re-run script).
- **RPC errors** — rate limits, missing `getPriorityFeeEstimate`, or send blocked; try another RPC; pass `--priority-micro-lamports` explicitly.

## End-to-end flow

1. Confirm coin name, symbol, metadata URI, signer wallet, and initial buy amount; set `SOLANA_RPC_URL`. Ask about mayhem mode, tokenized agent (with buyback percentage), cashback, and front-runner protection preferences.
2. Use `POST /agents/create-coin` to build the transaction. Only use `build-create-coin-tx.mjs` if the user explicitly requests scripts; capture `transaction`. Add `--mayhem-mode`, `--tokenized-agent --buyback-bps <BPS>`, `--cashback`, and/or `--front-runner-protection` (with optional `--tip-sol`) as needed.
3. Deserialize with `@solana/web3.js` `VersionedTransaction.deserialize`, have user sign (and co-sign create tx).
4. **Send the transaction:** If `frontRunnerProtection` is `true` in the script output JSON, send **only** to Jito endpoints (see "Transaction assembly and send" above). Otherwise use `sendRawTransaction` + `confirmTransaction`.
5. Keep `mint-keypair-out` secure; it is required for any mint-authority operations later.
