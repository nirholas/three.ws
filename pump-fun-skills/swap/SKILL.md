---
name: swap
description: >
  Buy and sell tokens on pump.fun bonding curve and pump swap AMM pool, and
  query SOL/token balances. Prefer runnable Node scripts in this skill folder;
  use @pump-fun/pump-sdk and @pump-fun/pump-swap-sdk for custom integrations.
metadata:
  author: pump-fun
  version: "1.0"
---

# Before Starting Work **Critical** - Ask these from user

**MANDATORY — Do NOT write or modify any code until every item below is answered by the user:**

- [ ] RPC URL provided or a fallback agreed upon (for any on-chain or tx-building step)
- [ ] **Signer wallet** public key (fee payer / user)
- [ ] Framework confirmed (Next.js, Express, CLI scripts only, other)
- [ ] Operation type confirmed (buy or sell)
- [ ] Coin mint address provided
- [ ] Amount confirmed (SOL lamports for buy; token smallest units for sell)
- [ ] Front-runner protection desired? If yes, confirm tip amount (default 0.0001 SOL). Transactions will be sent **only** to Jito block engine endpoints.

You MUST ask the user for ALL unchecked items in your very first response. Do not assume defaults. Do not proceed until the user has explicitly answered each one.

## API (preferred) — `https://fun-block.pump.fun`

Use the API to build swap transactions instead of running scripts directly. The API automatically determines coin state (bonding curve vs AMM) and builds the correct transaction.

### `POST /agents/swap`

Builds a buy or sell transaction. Set `inputMint` to `So11111111111111111111111111111111111111112` (NATIVE_MINT) for buys, or set `outputMint` to NATIVE_MINT for sells.

**Request body:**

```json
{
  "inputMint": "So11111111111111111111111111111111111111112",
  "outputMint": "<TOKEN_MINT>",
  "amount": "1000000",
  "user": "<PUBKEY>",
  "slippagePct": 2,
  "feePayer": "<PUBKEY>",
  "frontRunningProtection": false,
  "tipAmount": 0,
  "encoding": "base64"
}
```

Only `inputMint`, `outputMint`, `amount`, and `user` are required. All other fields have defaults.

> **`tipAmount`** is a Jito tip in **SOL** (e.g. `0.0001` for 100,000 lamports). Only relevant when `frontRunningProtection` is `true`.

> **Encoding:** The API defaults to `"base58"` encoding. **Always pass `"encoding": "base64"`** in the request body — scripts already output base64. When sending the signed transaction to an RPC or Jito endpoint, the encoding used to serialize the transaction must match the `encoding` parameter passed in the send call. Mismatched encodings will cause transaction failures. **Always** explicitly pass `encoding: "base64"` in `sendTransaction` / `simulateTransaction` RPC calls — never rely on the RPC's default.

- **Buy:** `inputMint` = NATIVE_MINT, `outputMint` = token mint, `amount` = SOL in lamports
- **Sell:** `inputMint` = token mint, `outputMint` = NATIVE_MINT, `amount` = token amount (6 decimals)

**Response:**

```json
{
  "transaction": "<base64-encoded VersionedTransaction>",
  "pumpMintInfo": { "hasGraduated": false, "expectedOutAmount": "123456", "..." : "..." }
}
```

Deserialize the `transaction`, have the user wallet sign, and submit to chain.

## Runnable examples (Node scripts — only when user explicitly requests)

Use **`{baseDir}`** as the path to this skill folder (OpenClaw and Agent Skills clients often expose this placeholder).

```bash
cd {baseDir}
npm install
export SOLANA_RPC_URL=https://rpc.solanatracker.io/public
```

| Operation | Script | Example |
| --------- | ------ | ------- |
| Fetch coin state (HTTP) | `scripts/fetch-coin.mjs` | `node scripts/fetch-coin.mjs --mint <MINT> --subset` |
| Buy (bonding curve) | `scripts/build-buy-bonding-tx.mjs` | `node scripts/build-buy-bonding-tx.mjs --mint <MINT> --user <PUBKEY> --amount 1000000` |
| Sell (bonding curve) | `scripts/build-sell-bonding-tx.mjs` | `node scripts/build-sell-bonding-tx.mjs --mint <MINT> --user <PUBKEY> --amount 1000000` |
| Buy (AMM) | `scripts/build-buy-amm-tx.mjs` | `node scripts/build-buy-amm-tx.mjs --mint <MINT> --user <PUBKEY> --amount 1000000` |
| Sell (AMM) | `scripts/build-sell-amm-tx.mjs` | `node scripts/build-sell-amm-tx.mjs --mint <MINT> --user <PUBKEY> --amount 1000000` |
| Balances | `scripts/print-balances.mjs` | `node scripts/print-balances.mjs --wallet <PUBKEY> --mint <MINT>` |

- Run any script with `--help` for full flags (`--slippage`, `--compute-units`, `--priority-micro-lamports`, `--front-runner-protection`, `--tip-sol`, `--pool` vs `--mint` for AMM, etc.).
- Tx builders print **one JSON object** on stdout with `transaction` (base64-encoded VersionedTransaction). **Never** pass end-user private keys into these scripts.
- **OpenClaw:** If YAML `metadata` ever fails to parse, collapse `metadata` to a single-line JSON object per [OpenClaw skills](https://docs.openclaw.ai/skills/); optional `metadata.openclaw.requires.env: ["SOLANA_RPC_URL"]` can gate load-time eligibility.

## Safety Rules

- **NEVER** log, print, or return private keys or secret key material.
- **NEVER** sign transactions on behalf of a user — scripts build txs; the user (or their wallet) co-signs and sends.
- Always validate that amounts are `> 0` before building instructions.
- Use the correct decimal precision: **9 decimals for SOL** (1 SOL = 1,000,000,000 lamports), **6 decimals for pump tokens**.
- Always check the coin state (bonding curve vs AMM pool) before choosing the right path.
- Always apply slippage protection on buy/sell transactions.
- **NEVER trust `token_program` from the HTTP API** (`coins-v2`). Always fetch the mint account on-chain via `connection.getAccountInfo(mint)` and use `.owner` to determine the correct token program (SPL Token or Token-2022).
- **Verify imports:** use `@pump-fun/pump-sdk` / `@pump-fun/pump-swap-sdk` (not internal monorepo paths). In TypeScript apps, `BN` from `bn.js` matches what the SDKs expect (Anchor `BN` is the same type in practice).

## Program IDs

| Program  | ID                                             |
| -------- | ---------------------------------------------- |
| Pump     | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` |
| Pump AMM | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` |

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
npm install @pump-fun/pump-sdk @pump-fun/pump-swap-sdk @solana/web3.js@^1.98.0 @solana/spl-token bn.js
```

Check `npm info @pump-fun/pump-sdk dependencies` and align `@solana/web3.js` / `@solana/spl-token` versions to avoid duplicate incompatible copies.

## SDK setup (minimal)

```typescript
import { PUMP_SDK, OnlinePumpSdk } from "@pump-fun/pump-sdk";
import { PUMP_AMM_SDK, OnlinePumpAmmSdk } from "@pump-fun/pump-swap-sdk";
import { Connection } from "@solana/web3.js";

const connection = new Connection(process.env.SOLANA_RPC_URL!);
const onlinePump = new OnlinePumpSdk(connection);
const onlineAmm = new OnlinePumpAmmSdk(connection);
```

Full transaction building (compute budget, blockhash, partial sign) is implemented in `scripts/lib/tx-build.mjs` and `scripts/lib/compute.mjs`.

## Determining coin state

Use `node scripts/fetch-coin.mjs --mint <MINT> --subset` or `GET`:

`https://frontend-api-v3.pump.fun/coins-v2/{mint}`

> **CORS-protected:** `frontend-api-v3.pump.fun` does not allow browser-origin requests. When building a web application, always call this endpoint from your backend/server and proxy the result to the frontend. Do not call it directly from client-side JavaScript.

```text
if (!coin.complete) → bonding curve → PUMP_SDK buy/sell
else if (coin.pump_swap_pool) → AMM → PUMP_AMM_SDK (pool = pump_swap_pool)
else → migrating / wait and retry
```

## Buy tokens (bonding curve)

**Default:** `POST /agents/swap` with `inputMint` = NATIVE_MINT (see API section above)
**Script (only when user explicitly requests):** `scripts/build-buy-bonding-tx.mjs`  
Requires `complete === false`. Uses `OnlinePumpSdk`, `bondingCurvePda`, `getBuyTokenAmountFromSolAmount`, `getBuySolAmountFromTokenAmount`, `PUMP_SDK.buyInstructions`. `tokenProgram` is the mint account's owner from RPC (`getAccountInfo(mint).owner` — SPL Token or Token-2022).

The buy script performs a two-step quote matching the frontend `blockchainStore.getSwapTx`:
1. `getBuyTokenAmountFromSolAmount(solInput)` — expected token amount
2. `getBuySolAmountFromTokenAmount(tokenAmount)` — precise SOL cost (accounts for rounding)

### Parameters (`buyInstructions`)

| Parameter                   | Type                          | Description        |
| --------------------------- | ----------------------------- | ------------------ |
| `global`                    | `Global`                      | Global state       |
| `bondingCurveAccountInfo`   | `AccountInfo<Buffer>`         | Raw account        |
| `bondingCurve`              | `BondingCurve`                | Decoded            |
| `associatedUserAccountInfo` | `AccountInfo<Buffer> \| null` | User ATA           |
| `mint` / `user`             | `PublicKey`                   |                    |
| `amount`                    | `BN`                          | Token out (6 dp)   |
| `solAmount`                 | `BN`                          | SOL in (lamports)  |
| `slippage`                  | `number`                      | **Percent** (below)|
| `tokenProgram`              | `PublicKey`                   | e.g. Token-2022    |

## Sell tokens (bonding curve)

**Default:** `POST /agents/swap` with `outputMint` = NATIVE_MINT (see API section above)
**Script (only when user explicitly requests):** `scripts/build-sell-bonding-tx.mjs`  
Uses `getSellSolAmountFromTokenAmount` and `PUMP_SDK.sellInstructions`. Same RPC-derived `tokenProgram` as the buy script.

### Parameters (`sellInstructions`)

| Parameter                 | Type                  | Description                                      |
| ------------------------- | --------------------- | ------------------------------------------------ |
| `global`                  | `Global`              | Global state                                     |
| `bondingCurveAccountInfo` | `AccountInfo<Buffer>` | Raw account                                      |
| `bondingCurve`            | `BondingCurve`        | Decoded                                          |
| `mint` / `user`           | `PublicKey`           |                                                  |
| `amount`                  | `BN`                  | Token to sell (6 dp)                             |
| `solAmount`               | `BN`                  | Expected SOL out (lamports)                      |
| `slippage`                | `number`              | **Percent** (below)                              |
| `tokenProgram`            | `PublicKey`           | e.g. Token-2022                                  |
| `mayhemMode`              | `boolean`             | Derived from `bondingCurve.isMayhemMode`         |
| `cashback`                | `boolean`             | Derived from `bondingCurve.isCashbackCoin`       |

The sell script reads `mayhemMode` and `cashback` from the decoded on-chain bonding curve account automatically, matching the frontend `blockchainStore.getSwapTx` behavior. No flags needed.

## Buy / sell (AMM, post-graduation)

**Default:** `POST /agents/swap` — the API automatically detects graduated coins and builds AMM transactions.
**Script (only when user explicitly requests):** `scripts/build-buy-amm-tx.mjs`, `scripts/build-sell-amm-tx.mjs`  
Uses `OnlinePumpAmmSdk.swapSolanaState(pool, user)` and:

- Buy: `PUMP_AMM_SDK.buyQuoteInput` (SOL in) or `PUMP_AMM_SDK.buyBaseInput` (token out)
- Sell: `PUMP_AMM_SDK.sellBaseInput` (token in) or `PUMP_AMM_SDK.sellQuoteInput` (SOL out target)

## Slippage

The pump bonding SDK takes slippage as a **percentage number** (e.g. `10` = 10%), **not** basis points. Same convention is used in the frontend `getSwapTx` path. The SDK applies it internally (e.g. max SOL cost scales with `floor(slippage * 10) / 1000`).

## Compute units and priority fees

Defaults match the pump.fun app constants (see `scripts/lib/constants.mjs` in this skill):

| Operation        | Default compute units |
| ---------------- | --------------------- |
| Bonding buy/sell | **120_000** each      |
| AMM buy/sell     | **200_000**           |

Scripts accept `--compute-units` to override.

**Priority fee:** If `--priority-micro-lamports` is omitted, scripts call Solana JSON-RPC `getPriorityFeeEstimate` on a draft serialized transaction (with a 100k microlamport floor and an upper cap — see `scripts/lib/compute.mjs`). Many RPCs support this; if not, the floor is used.

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
  jsonrpc: "2.0", id: 1, method: "sendTransaction",
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

## Get balances

**Script:** `scripts/print-balances.mjs` (RPC + optional `--use-profile-api`).

### SOL / token (on-chain)

Use `connection.getBalance` for lamports; `getAssociatedTokenAddressSync` + `getAccount` for the ATA (6 decimals for pump tokens).

### Pump.fun HTTP APIs

`GET https://profile-api.pump.fun/balance/summary/{wallet}`

```json
{
  "success": true,
  "data": {
    "native_balance": 1.5,
    "native_lamports": 1500000000,
    "sol_price": 145.23,
    "total_value": 217.85
  }
}
```

`GET https://profile-api.pump.fun/balance/tokens/{wallet}?page=1&size=50`

```json
{
  "success": true,
  "data": {
    "tokens": [
      {
        "token_mint": "ABcDeFgHiJkLmNoPqRsTuVwXyZ123456789abcdefg",
        "token_name": "MyToken",
        "token_symbol": "MTK",
        "token_image": "https://ipfs.io/ipfs/Qm...",
        "token_price": 0.00123,
        "balance": 5000000,
        "value": 6.15,
        "usd_market_cap": 50000
      }
    ]
  },
  "pagination": { "page": 1, "size": 50, "total": 3, "totalPages": 1 }
}
```

`GET https://frontend-api-v3.pump.fun/sol-price`

> **CORS-protected** — call from backend only (see note in "Determining coin state" above).

```json
{ "solPrice": 145.23 }
```

## Get coin data (HTTP)

`GET https://frontend-api-v3.pump.fun/coins-v2/{mint}`

> **CORS-protected** — call from backend only (see note in "Determining coin state" above).

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

| Field                    | Notes                                      |
| ------------------------ | ------------------------------------------ |
| `complete`               | `true` when graduated off bonding curve    |
| `pump_swap_pool`         | AMM pool address when on pump swap         |
| `bonding_curve`          | Bonding curve PDA address                  |
| `token_program`          | **Do NOT trust this value** — always verify on-chain (see below) |

> **NEVER trust `token_program` from the HTTP API.** The `coins-v2` endpoint may return a stale or incorrect `token_program`. Always resolve it on-chain by fetching the mint account and reading its owner:
>
> ```typescript
> const mintAccountInfo = await connection.getAccountInfo(mintPublicKey);
> const tokenProgram = mintAccountInfo.owner; // TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID
> ```
>
> The skill scripts already do this via `tokenProgramIdFromMint()` in `scripts/lib/coin-resolve.mjs`. Any custom integration **must** do the same.

## Quote helpers (bonding curve)

Pure functions from `@pump-fun/pump-sdk` (see script source for usage):

- `getBuyTokenAmountFromSolAmount`
- `getBuySolAmountFromTokenAmount`
- `getSellSolAmountFromTokenAmount`

All need `global`, `feeConfig` (`fetchFeeConfig()`), `mintSupply`, and `bondingCurve`.

## Error handling and troubleshooting

- **`complete === true` but `pump_swap_pool` is null** — migration window; retry later; do not use bonding instructions.
- **Bonding curve account missing** — wrong mint, wrong network, or uninitialized coin.
- **`Coin has graduated` / AMM script errors on bonding-only coin** — re-fetch `coins-v2` and switch script path.
- **Insufficient SOL** — user cannot pay buy amount or fees; check `nativeLamports` before building.
- **Slippage / simulation failures** — increase slippage cautiously, check pool reserves, retry with fresh blockhash (re-run script).
- **ATA missing** — first buy may create ATA inside the same tx; if a custom flow fails, ensure ATA creation is included or pre-created.
- **RPC errors** — rate limits, missing `getPriorityFeeEstimate`, or send blocked; try another RPC; pass `--priority-micro-lamports` explicitly.

## End-to-end flow

1. Confirm operation (buy or sell), mint address, and signer wallet; set `SOLANA_RPC_URL`. Ask if front-runner protection is desired.
2. Use `POST /agents/swap` — the API automatically determines coin state and builds the correct transaction. Only use scripts if the user explicitly requests them: `fetch-coin` (or HTTP) → check coin state (see decision tree) → choose bonding or AMM script → run the appropriate `build-*` script; capture `transaction`. Add `--front-runner-protection` (and optionally `--tip-sol`) if the user wants Jito-only submission.
3. Deserialize with `@solana/web3.js` `VersionedTransaction.deserialize`, have user sign.
4. **Send the transaction:** If `frontRunnerProtection` is `true` in the script output JSON, send **only** to Jito endpoints (see "Transaction assembly and send" above). Otherwise use `sendRawTransaction` + `confirmTransaction`.
