# Task 04 — Backend: Solana Transaction Builder API

## Goal
Create a single API file `api/tx/solana/[action].js` with two endpoints:
- `POST /api/tx/solana/build-transfer` — builds a serialized Solana transaction for SOL or SPL token transfer
- `POST /api/tx/solana/build-swap` — fetches a swap transaction from Jupiter v6 for any token pair

The frontend tool body will call these endpoints, receive a base64-encoded serialized transaction, have the user sign it via `window.solana`, then broadcast it.

## Context
- Existing API files (e.g., `api/payments/solana/[action].js`) use helpers from `api/_lib/`:
  - `cors`, `json`, `method`, `readJson`, `wrap`, `error` from `api/_lib/http.js`
  - `getSessionUser` from `api/_lib/auth.js`
  - `parse` + `z` (zod) from `api/_lib/validate.js`
  - `limits`, `clientIp` from `api/_lib/rate-limit.js`
- Solana RPC env vars: `SOLANA_RPC_URL` (mainnet), `SOLANA_RPC_URL_DEVNET`
- Available npm packages (already in package.json or resolvable): `@solana/web3.js`, `@solana/spl-token`

## `api/tx/solana/[action].js`

### Imports
```js
import { z } from 'zod';
import {
  Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount, createTransferInstruction,
  getMint, getAssociatedTokenAddress
} from '@solana/spl-token';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { getSessionUser } from '../../_lib/auth.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { parse } from '../../_lib/validate.js';
```

### `handleBuildTransfer`

Schema:
```js
const transferSchema = z.object({
  sender:  z.string(),          // base58 sender public key
  recipient: z.string(),        // base58 recipient public key
  amount:  z.number().positive(), // human-readable (e.g. 1.5 SOL or 10 USDC)
  token:   z.string().default('SOL'),  // 'SOL' or SPL mint address
  memo:    z.string().optional(),
  network: z.enum(['mainnet', 'devnet']).default('mainnet'),
});
```

Logic:
1. Validate auth: require `getSessionUser` (return 401 if not signed in).
2. Build `Connection` from RPC URL based on network.
3. If `token === 'SOL'`:
   - `SystemProgram.transfer({ fromPubkey, toPubkey, lamports: amount * LAMPORTS_PER_SOL })`
4. If token is an SPL mint address:
   - Get sender ATA: `getAssociatedTokenAddress(mint, senderPubkey)`
   - Get recipient ATA: `getAssociatedTokenAddress(mint, recipientPubkey)`
   - Get mint decimals via `getMint(connection, mint)`
   - Build `createTransferInstruction(senderATA, recipientATA, senderPubkey, amountInSmallestUnit)`
   - Note: the transaction includes creating the recipient ATA if it doesn't exist (add `createAssociatedTokenAccountInstruction` if needed, checking `connection.getAccountInfo(recipientATA)`)
5. Fetch recent blockhash: `connection.getLatestBlockhash()`
6. Assemble `Transaction`, set `feePayer = senderPubkey`, set `recentBlockhash`
7. If memo is provided, add a memo instruction using the SPL Memo program: `new TransactionInstruction({ keys: [], programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), data: Buffer.from(memo, 'utf-8') })`
8. Serialize: `tx.serialize({ requireAllSignatures: false })` → base64
9. Return:
```js
json(res, 200, {
  transaction: base64EncodedTx,
  network,
  blockhash: latestBlockhash.blockhash,
  lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
});
```

### `handleBuildSwap`

Schema:
```js
const swapSchema = z.object({
  sender:      z.string(),           // base58 wallet pubkey
  inputMint:   z.string(),           // token mint to sell
  outputMint:  z.string(),           // token mint to buy
  amount:      z.number().positive(), // human-readable input amount
  slippageBps: z.number().int().min(1).max(5000).default(50),
  network:     z.enum(['mainnet']).default('mainnet'), // Jupiter only supports mainnet
});
```

Logic:
1. Require auth.
2. Get mint decimals for `inputMint` via RPC to compute `amountInSmallestUnit`.
3. Fetch Jupiter v6 quote:
   ```
   GET https://quote-api.jup.ag/v6/quote?inputMint={inputMint}&outputMint={outputMint}&amount={amountInSmallestUnit}&slippageBps={slippageBps}
   ```
4. If quote fails or no routes, return 422 with `{ error: 'no_route', message: 'No swap route found' }`.
5. Fetch swap transaction from Jupiter:
   ```
   POST https://quote-api.jup.ag/v6/swap
   Body: { quoteResponse: <quote>, userPublicKey: sender, wrapAndUnwrapSol: true }
   ```
6. Return:
```js
json(res, 200, {
  transaction: swapResponse.swapTransaction, // already base64
  network: 'mainnet',
  inputAmount: amount,
  outputAmount: quoteResponse.outAmount / 10**outputDecimals,
  outputMint,
  priceImpactPct: quoteResponse.priceImpactPct,
});
```

### Router
```js
export default wrap(async (req, res) => {
  const action = req.url.split('/').pop().split('?')[0];
  if (action === 'build-transfer') return handleBuildTransfer(req, res);
  if (action === 'build-swap')     return handleBuildSwap(req, res);
  return error(res, 404, 'not_found', 'unknown action');
});
```

## Verification
- `POST /api/tx/solana/build-transfer` with `{ sender, recipient, amount: 0.001, token: 'SOL', network: 'devnet' }` returns `{ transaction: '<base64>', blockhash, lastValidBlockHeight }`.
- `POST /api/tx/solana/build-swap` with a valid Jupiter mainnet pair returns `{ transaction, outputAmount, priceImpactPct }`.
- Unauthenticated requests return 401.
- Invalid body returns 400/422.
