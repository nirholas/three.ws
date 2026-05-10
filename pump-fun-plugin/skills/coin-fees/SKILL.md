---
name: coin-fees
description: >
  Inspect and manage creator fees on pump.fun — determine fee destinations
  (cashback, shared config, or direct creator), collect fees, distribute
  shared fees to shareholders, and query vault balances. Prefer runnable
  Node scripts in this skill folder; use @pump-fun/pump-sdk and
  @pump-fun/pump-swap-sdk for custom integrations.
metadata:
  author: pump-fun
  version: "1.0"
---

# Before Starting Work **Critical** - Ask these from user

**MANDATORY — Do NOT write or modify any code until every item below is answered by the user:**

- [ ] RPC URL provided or a fallback agreed upon (for any on-chain or tx-building step)
- [ ] **Signer wallet** public key (fee payer / crank caller)
- [ ] Framework confirmed (Next.js, Express, CLI scripts only, other)
- [ ] Coin mint address provided
- [ ] Operation type confirmed: inspect fee destination, collect (crank) fee, distribute shared fees, check distributable amount, or create/update sharing config

You MUST ask the user for ALL unchecked items in your very first response. Do not assume defaults. Do not proceed until the user has explicitly answered each one.

## API (preferred) — `https://fun-block.pump.fun`

Use the API to build fee transactions instead of running scripts directly. The API handles account resolution, sharing config detection, and graduation status automatically.

### `POST /agents/collect-fees`

Builds a transaction to collect or distribute creator fees. Automatically detects whether the coin uses a sharing config and builds the appropriate transaction (collect for direct creator, distribute for sharing config).

**Request body:**

```json
{
  "mint": "<TOKEN_MINT>",
  "user": "<PUBKEY>",
  "frontRunningProtection": false,
  "tipAmount": 0,
  "encoding": "base64"
}
```

Only `mint` and `user` are required.

> **`tipAmount`** is a Jito tip in **SOL** (e.g. `0.0001` for 100,000 lamports). Only relevant when `frontRunningProtection` is `true`.

> **Encoding:** The API defaults to `"base58"` encoding. **Always pass `"encoding": "base64"`** in the request body — scripts already output base64. When sending the signed transaction to an RPC or Jito endpoint, the encoding used to serialize the transaction must match the `encoding` parameter passed in the send call. Mismatched encodings will cause transaction failures. **Always** explicitly pass `encoding: "base64"` in `sendTransaction` / `simulateTransaction` RPC calls — never rely on the RPC's default.

**Response:**

```json
{
  "transaction": "<base64-encoded VersionedTransaction>",
  "creator": "<base58 creator address>",
  "isGraduated": true,
  "usesSharingConfig": false
}
```

### `POST /agents/sharing-config`

Builds a transaction to create or update a fee sharing config for a coin. Auto-detects create vs update mode based on on-chain state.

**Request body:**

```json
{
  "mint": "<TOKEN_MINT>",
  "user": "<PUBKEY>",
  "shareholders": [
    { "address": "<PUBKEY>", "bps": 5000 },
    { "address": "<PUBKEY>", "bps": 5000 }
  ],
  "mode": "create",
  "frontRunningProtection": false,
  "tipAmount": 0,
  "encoding": "base64"
}
```

Only `mint`, `user`, and `shareholders` are required. `mode` is auto-detected if omitted. `bps` values must total exactly 10,000 (100%). Maximum 10 shareholders.

> **`tipAmount`** is a Jito tip in **SOL** (e.g. `0.0001` for 100,000 lamports). Only relevant when `frontRunningProtection` is `true`.

**Response:**

```json
{
  "transaction": "<base64-encoded VersionedTransaction>",
  "mode": "create",
  "sharingConfigAddress": "<base58>",
  "shareholderCount": 2,
  "shareholders": [{ "address": "<base58>", "bps": 5000 }, { "address": "<base58>", "bps": 5000 }],
  "isGraduated": true
}
```

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
| Inspect fee destination & vault balances | `scripts/fetch-fee-info.mjs` | `node scripts/fetch-fee-info.mjs --mint <MINT>` |
| Collect creator fee (direct, no sharing) | `scripts/build-collect-fee-tx.mjs` | `node scripts/build-collect-fee-tx.mjs --mint <MINT> --user <PUBKEY>` |
| Distribute shared fees (sharing config) | `scripts/build-distribute-fees-tx.mjs` | `node scripts/build-distribute-fees-tx.mjs --mint <MINT> --user <PUBKEY>` |
| Check distributable amounts (simulation) | `scripts/fetch-distributable-info.mjs` | `node scripts/fetch-distributable-info.mjs --mint <MINT>` |
| Create or update sharing config | `scripts/build-sharing-config-tx.mjs` | `node scripts/build-sharing-config-tx.mjs --mint <MINT> --user <PUBKEY> --shareholders '<JSON>'` |

- Run any script with `--help` for full flags (`--compute-units`, `--priority-micro-lamports`, `--front-runner-protection`, `--tip-sol`, etc.).
- Tx builders print **one JSON object** on stdout with `transaction` (base64-encoded VersionedTransaction). **Never** pass end-user private keys into these scripts.
- **OpenClaw:** If YAML `metadata` ever fails to parse, collapse `metadata` to a single-line JSON object per [OpenClaw skills](https://docs.openclaw.ai/skills/); optional `metadata.openclaw.requires.env: ["SOLANA_RPC_URL"]` can gate load-time eligibility.

## Safety Rules

- **NEVER** log, print, or return private keys or secret key material.
- **NEVER** sign transactions on behalf of a user — scripts build txs; the user (or their wallet) co-signs and sends.
- Always validate that addresses are valid base58 public keys before building instructions.
- Use the correct decimal precision: **9 decimals for SOL** (1 SOL = 1,000,000,000 lamports), **6 decimals for pump tokens**.
- **NEVER trust `token_program` from the HTTP API** (`coins-v2`). Always fetch the mint account on-chain via `connection.getAccountInfo(mint)` and use `.owner` to determine the correct token program (SPL Token or Token-2022).
- **Verify imports:** use `@pump-fun/pump-sdk` / `@pump-fun/pump-swap-sdk` (not internal monorepo paths). In TypeScript apps, `BN` from `bn.js` matches what the SDKs expect (Anchor `BN` is the same type in practice).

## Program IDs

| Program   | ID                                             |
| --------- | ---------------------------------------------- |
| Pump      | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` |
| Pump AMM  | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` |
| Pump Fees | `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ` |

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
import {
  PUMP_SDK,
  OnlinePumpSdk,
  isCreatorUsingSharingConfig,
  creatorVaultPda,
  feeSharingConfigPda,
  canonicalPumpPoolPda,
  bondingCurvePda,
} from "@pump-fun/pump-sdk";
import {
  OnlinePumpAmmSdk,
  coinCreatorVaultAuthorityPda,
  coinCreatorVaultAtaPda,
  getPumpAmmProgram,
} from "@pump-fun/pump-swap-sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";

const connection = new Connection(process.env.SOLANA_RPC_URL!);
const onlinePump = new OnlinePumpSdk(connection);
```

Full transaction building (compute budget, blockhash, partial sign) is implemented in `scripts/lib/tx-build.mjs` and `scripts/lib/compute.mjs`.

## Fee destination logic

When an agent needs to understand where creator fees go for a coin, follow this decision tree:

```text
1. Fetch bonding curve + check for pool (graduated?)
2. Read isCashbackCoin from pool (if graduated) or bonding curve (if not)
   ├─ isCashbackCoin === true
   │   → Fees go to TRADERS as cashback (via userVolumeAccumulator)
   │   → No creator vault — fees are returned to traders as trading cashback
   │   → Use `POST /agents/collect-fees` with the user's wallet to claim their cashback
   │   → Claims from pump program; also claims from pump AMM (with WSOL unwrap) if graduated
   │
   └─ isCashbackCoin === false
       3. Check isCreatorUsingSharingConfig({ mint, creator })
          ├─ true → Fees go to SHARING CONFIG SHAREHOLDERS
          │   → Load feeSharingConfigPda(mint) → decodeSharingConfig
          │   → Lists shareholders with address + BPS shares
          │   → The pool/bonding curve creator == feeSharingConfigPda(mint) when migrated
          │   → Use `POST /agents/collect-fees` to distribute; only use build-distribute-fees-tx.mjs if the user explicitly requests scripts
          │
          └─ false → Fees go to COIN CREATOR directly
              → Creator = pool.coinCreator (graduated) or bondingCurve.creator
              → Creator vault = creatorVaultPda(creator)
              → Use `POST /agents/collect-fees` to collect; only use build-collect-fee-tx.mjs if the user explicitly requests scripts
```

Script: `fetch-fee-info.mjs` resolves this entire tree and outputs the destination.

## PDAs and accounts

| PDA | Seed | Program |
| --- | ---- | ------- |
| `creatorVaultPda(creator)` | `"creator-vault" + creator` | Pump |
| `feeSharingConfigPda(mint)` | `"sharing-config" + mint` | Pump Fees |
| `coinCreatorVaultAuthorityPda(creator)` | AMM-derived | Pump AMM |
| `coinCreatorVaultAtaPda(authority, NATIVE_MINT)` | ATA | SPL Token |
| `canonicalPumpPoolPda(mint)` | Pool PDA | Pump AMM |
| `bondingCurvePda(mint)` | `"bonding-curve" + mint` | Pump |

## Vault balance calculation

Creator fee vault balance is the sum of two sources:

1. **Pump creator vault** (native SOL): `creatorVaultPda(creator)` lamports minus rent exemption (890,880 lamports)
2. **AMM creator vault** (WSOL token account): `coinCreatorVaultAtaPda(coinCreatorVaultAuthorityPda(creator), NATIVE_MINT)` token balance

Total available = (1) + (2)

When a sharing config exists, `creator` is `feeSharingConfigPda(mint)` (the sharing config PDA address).

## Collecting fees (no sharing config)

- **Script:** `scripts/build-collect-fee-tx.mjs`
- Uses `OnlinePumpSdk.collectCoinCreatorFeeInstructions(creator, payer)`
- This calls both:
  1. Pump program `collectCreatorFee` — moves SOL from `creatorVaultPda(creator)` to creator wallet
  2. Pump AMM `collectCoinCreatorFee` — moves WSOL from AMM vault to creator's WSOL ATA (creates ATA if needed)
- **Permissionless** — anyone can call this to trigger fee collection to the creator

### Parameters (`build-collect-fee-tx.mjs`)

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| `--mint` | `PUBKEY` | Coin mint address |
| `--user` | `PUBKEY` | Transaction fee payer |
| `--creator` | `PUBKEY` | (Optional) Creator to collect for; auto-derived from on-chain state if omitted |
| `--compute-units` | `int` | Override compute unit limit |
| `--priority-micro-lamports` | `int` | Override priority fee |
| `--front-runner-protection` | flag | Add Jito tip; send ONLY to Jito endpoints |
| `--tip-sol` | `float` | Jito tip in SOL (default 0.0001) |

## Distributing fees (with sharing config)

- **Script:** `scripts/build-distribute-fees-tx.mjs`
- For **graduated** coins (pool exists):
  1. Create WSOL ATA for sharing config authority (idempotent)
  2. `transferCreatorFeesToPump()` — AMM program moves WSOL from AMM vault to pump creator vault
  3. `PUMP_SDK.distributeCreatorFees({ mint, sharingConfig, sharingConfigAddress })` — splits vault balance to shareholders
- For **ungraduated** coins (bonding curve only):
  1. `PUMP_SDK.distributeCreatorFees(...)` only
- **Permissionless** — anyone can trigger distribution

### Parameters (`build-distribute-fees-tx.mjs`)

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| `--mint` | `PUBKEY` | Coin mint address |
| `--user` | `PUBKEY` | Transaction fee payer |
| `--compute-units` | `int` | Override compute unit limit |
| `--priority-micro-lamports` | `int` | Override priority fee |
| `--front-runner-protection` | flag | Add Jito tip; send ONLY to Jito endpoints |
| `--tip-sol` | `float` | Jito tip in SOL (default 0.0001) |

## Creating or updating a sharing config

- **Script:** `scripts/build-sharing-config-tx.mjs`
- **Create mode:** Sets up a new fee sharing config for a coin. The coin creator must sign.
  1. `PUMP_SDK.createFeeSharingConfig({ creator, mint, pool })` — initializes config
  2. `PUMP_SDK.updateFeeShares(...)` — sets the desired shareholder split
- **Update mode:** Modifies shareholders on an existing config. The admin must sign.
  1. `PUMP_SDK.updateFeeShares({ authority, mint, currentShareholders, newShareholders })` — updates split
- Auto-detects create vs update from on-chain state; use `--mode` to force.
- **Important:** Reward split updates are effectively one-time. Once updated, the config may no longer be editable (depending on version and admin revocation status). Verify the final split before submitting.
- Shareholders are passed as a JSON array: `[{"address":"<PUBKEY>","bps":5000},...]`
- `bps` = basis points (1 bps = 0.01%). Total must equal exactly 10,000 (100%).
- Maximum 10 shareholders. No duplicate addresses.

### Parameters (`build-sharing-config-tx.mjs`)

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| `--mint` | `PUBKEY` | Coin mint address |
| `--user` | `PUBKEY` | Fee payer (creator for create, admin for update) |
| `--shareholders` | `JSON` | JSON array of `{"address":"<PUBKEY>","bps":<int>}` objects |
| `--mode` | `create\|update` | (Optional) Force create or update; auto-detected if omitted |
| `--compute-units` | `int` | Override compute unit limit |
| `--priority-micro-lamports` | `int` | Override priority fee |
| `--front-runner-protection` | flag | Add Jito tip; send ONLY to Jito endpoints |
| `--tip-sol` | `float` | Jito tip in SOL (default 0.0001) |

## Checking distributable amounts

- **Script:** `scripts/fetch-distributable-info.mjs`
- Simulation-only: does NOT send a transaction
- Uses `PUMP_SDK.getMinimumDistributableFee` via `simulateTransaction`
- Returns decoded result: `minimumRequired`, `distributableFees`, `canDistribute`
- Also reads vault balances (pump + AMM sides) and graduation status

## Compute units and priority fees

Defaults match the pump.fun app constants (see `scripts/lib/constants.mjs` in this skill):

| Operation | Default compute units |
| --------- | --------------------- |
| Collect fee (direct creator) | **200_000** |
| Distribute fees (sharing config) | **200_000** |

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

- **Cashback coin** — `isCashbackCoin === true`: no creator vault, but users can claim their trading cashback via `POST /agents/collect-fees`. The endpoint builds a transaction that claims from the pump program, and also from the pump AMM (with WSOL unwrapping) if the coin has graduated. `fetch-fee-info.mjs` returns `feeDestination: "cashback"`.
- **Sharing config not active** — the account at `feeSharingConfigPda(mint)` may not exist or may be in a non-active state; `fetch-fee-info.mjs` will report `hasSharingConfig: false`.
- **Vault below minimum distributable threshold** — `fetch-distributable-info.mjs` returns `canDistribute: false` and shows `minimumRequired` vs actual balance.
- **Bonding curve account missing** — wrong mint, wrong network, or uninitialized coin.
- **Pool not found (not graduated)** — coin is still on bonding curve; AMM-side fees do not exist yet.
- **RPC errors** — rate limits, missing `getPriorityFeeEstimate`, or send blocked; try another RPC; pass `--priority-micro-lamports` explicitly.

## End-to-end flow

1. Confirm coin mint address, signer wallet, and operation type; set `SOLANA_RPC_URL`.
2. Run `fetch-fee-info.mjs --mint <MINT>` to inspect fee destination (`cashback`, `sharing_config`, or `creator`), vault balances, and sharing config shareholders if applicable.
3. Based on `feeDestination`:
   - `"cashback"` → Use `POST /agents/collect-fees` with the user's wallet to claim their trading cashback (claims from pump program + pump AMM if graduated).
   - `"creator"` → Use `POST /agents/collect-fees` to build a crank transaction. Only use `build-collect-fee-tx.mjs` if the user explicitly requests scripts.
   - `"sharing_config"` → Use `POST /agents/collect-fees` to distribute. Only use `fetch-distributable-info.mjs` and `build-distribute-fees-tx.mjs` if the user explicitly requests scripts.
   - To **create or update** a sharing config → Use `POST /agents/sharing-config`. Only use `build-sharing-config-tx.mjs` if the user explicitly requests scripts.
4. Capture `transaction` from the script output.
5. Deserialize with `@solana/web3.js` `VersionedTransaction.deserialize`, have user sign.
6. **Send the transaction:** If `frontRunnerProtection` is `true` in the script output JSON, send **only** to Jito endpoints (see "Transaction assembly and send" above). Otherwise use `sendRawTransaction` + `confirmTransaction`.
