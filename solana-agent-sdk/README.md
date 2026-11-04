<p align="center">
  <a href="https://three.ws"><img src="https://three.ws/three-ws-mcp-icon.svg" width="72" height="72" alt="three.ws" /></a>
</p>

<h1 align="center">@three-ws/solana-agent</h1>

<p align="center"><strong>Solana agent SDK: keypair + browser wallets, SOL/SPL transfers, Jupiter swaps, staking, and the x402 exact payment scheme.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@three-ws/solana-agent"><img alt="npm" src="https://img.shields.io/npm/v/@three-ws/solana-agent?logo=npm&color=cb3837"></a>
  <a href="https://www.npmjs.com/package/@three-ws/solana-agent"><img alt="downloads" src="https://img.shields.io/npm/dm/@three-ws/solana-agent?color=cb3837"></a>
  <img alt="license" src="https://img.shields.io/npm/l/@three-ws/solana-agent?color=3b82f6">
  <img alt="node" src="https://img.shields.io/node/v/@three-ws/solana-agent?color=339933&logo=node.js">
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#entry-points">Entry points</a> ·
  <a href="#wallet-providers">Wallets</a> ·
  <a href="#x402-exact-payments">x402</a> ·
  <a href="https://three.ws">three.ws</a>
</p>

---

> A typed Solana SDK for AI agents. Give an agent a wallet (its own keypair for
> autonomous signing, or a browser wallet that defers signing to the user), then
> transfer SOL and SPL tokens, swap via Jupiter, stake, pay x402 invoices,
> and plug into solana-agent-kit. Dual ESM/CJS, fully typed.

## Install

```
npm install @three-ws/solana-agent @solana/web3.js
```

`@solana/web3.js` (`^1.98`) is the base it builds on; `@solana/spl-token` and `@coral-xyz/anchor` ship as direct dependencies. `zod` is an optional peer dependency: the root, `/wallet`, `/x402-exact`, and `/vanity` entries work without it, but importing `/solana-agent-kit` requires it (`npm install zod`).

## Entry points

The package exposes these subpath exports (each dual ESM/CJS with type declarations):

| Import | What it provides |
| --- | --- |
| `@three-ws/solana-agent` | the `SolanaAgent` class, all wallet providers, action functions, tx utilities, and error classes |
| `@three-ws/solana-agent/wallet` | the wallet providers (re-exported from the root) |
| `@three-ws/solana-agent/x402-exact` | the x402 "exact" payment scheme for SPL Token and Token-2022 assets (payer + facilitator) |
| `@three-ws/solana-agent/solana-agent-kit` | a `solana-agent-kit` plugin and tool-call `Action` definitions |
| `@three-ws/solana-agent/vanity` | provably-fair vanity wallet grinding: one-call client, receipt verifier, sealed-envelope opener |

## Quick start

`SolanaAgent` is the main entry. Use the static factories: `fromKeypair` (the agent holds the key and signs autonomously) or `fromBrowserWallet` (signing is deferred to the user's wallet).

```js
import { SolanaAgent } from '@three-ws/solana-agent';

// Agent-controlled wallet (base58 secret key, Uint8Array, or number[]).
const agent = SolanaAgent.fromKeypair(process.env.SOLANA_SECRET_KEY, 'https://api.mainnet-beta.solana.com');

console.log(agent.publicKey.toBase58());
const lamports = await agent.getBalance();
```

### Actions

`SolanaAgent` exposes the on-chain actions as instance methods:

```js
// Send native SOL (amount in SOL, not lamports). Returns the tx signature.
const sig = await agent.transferSol('<recipient>', 0.01);

// Send SPL tokens (amount in base units, as a bigint).
await agent.transferSpl('<mint>', '<recipient>', 1_000_000n);

// Jupiter swap, and a quote-only variant.
const quote = await agent.getSwapQuote({ inputMint, outputMint, amount });
await agent.swap({ inputMint, outputMint, amount });

// Token balances / accounts (classic SPL Token and Token-2022, e.g. $THREE).
const bal = await agent.getTokenBalance('<mint>');   // null if the mint or the account does not exist
const accounts = await agent.getTokenAccounts();      // non-zero balances only, both programs

// Associated token account.
const { address, created } = await agent.getOrCreateAta({ mint: '<mint>' });

// Staking.
await agent.stakeSOL('<voteAccount>', 1);             // amount in SOL
await agent.unstakeSOL('<stakeAccount>');             // withdrawable after ~1 epoch
const stakes = await agent.getStakeAccounts();
```

Every result carries `programId` (which token program owns the mint) and `uiAmount` as an exact decimal string. RPC failures reject rather than reading as "no balance".

The underlying functions (`transferSol`, `transferSpl`, `jupiterSwap`, `getSwapQuote`, `getTokenBalance`, `getTokenAccounts`, `getOrCreateAta`, `stakeSOL`, `unstakeSOL`, `getStakeAccounts`) and the `SOL_MINT` constant are also exported from the root for functional use.

## Wallet providers

All implement the same `WalletProvider` interface, so they are interchangeable in `new SolanaAgent({ wallet, connection })`:

- `KeypairWalletProvider`: server-side keypair. `new KeypairWalletProvider(privateKey, { commitment, confirmTimeoutMs })` accepts a base58 string, `Uint8Array`, or `number[]`. It adds its signature without clearing co-signers already on the transaction.
- `BrowserWalletProvider`: server half of a split browser-signing flow (`createHandler()` mounts on your HTTP server). Options include `commitment` and `confirmTimeoutMs`. `POST /sign/:id` answers with a `SignOutcome` (`{ ok, signature?, error? }`) once the transaction confirms or fails.
- `BrowserWalletClient`: browser half; signs via a user-supplied `SignerFn` with an `ApprovalHandler`. `onConfirmed(pending, signature)` fires when the transaction lands; `onFailed(pending, error, signature?)` fires when the agent refuses it or it fails on-chain, so the UI never shows a failed payment as sent.
- `WalletAdapterProvider`: wraps a `@solana/wallet-adapter` wallet.

### Confirmation

`signAndSendTransaction(tx, connection, confirm?)` resolves only once the transaction reached the requested commitment **and executed without error**. A transaction that lands but fails throws `TransactionFailedError` instead of returning its signature. The optional `confirm` argument (`ConfirmOptions`):

| Field | Default | Meaning |
| --- | --- | --- |
| `commitment` | `"confirmed"` | `"processed"`, `"confirmed"`, or `"finalized"` |
| `timeoutMs` | `90000` (`DEFAULT_CONFIRM_TIMEOUT_MS`) | give up with `ConfirmationTimeoutError` |
| `lastValidBlockHeight` | the tx's own, when it has one | stop as soon as the blockhash expires instead of waiting out the timeout |
| `pollIntervalMs` | `500` | delay between status polls |

`confirmSignature(connection, signature, opts)` is exported for confirming a signature you sent yourself. `buildAndSend` (used by every action) takes `signers` for extra keypairs such as a new stake account, plus `commitment`, `confirmTimeoutMs`, and `maxRetries`: it rebuilds with a fresh blockhash only when the previous one expired, and throws `RetriesExhaustedError` when every attempt expired. Swaps pass Jupiter's `lastValidBlockHeight` through, so an expired swap fails fast.

`isMetaAware()` plus the `TxMetadata` / `MetaAwareWallet` types support attaching memo/metadata to transactions.

## x402 exact payments

The `exact` scheme transfers a fixed token amount via an SPL `TransferChecked` and returns the tx signature as the proof for an x402 `X-PAYMENT` header. Compatible with x402 v2. The asset can be a classic SPL Token mint (USDC) or a Token-2022 mint such as $THREE, and the payee can be a wallet or a program-derived vault: both the payer and the facilitator resolve the right token program. Every payment carries the server-issued challenge nonce as a memo, so it cannot be replayed against another request.

```js
import { payExact, buildExactPaymentPayload, USDC_MAINNET, SOLANA_MAINNET } from '@three-ws/solana-agent/x402-exact';

const requirements = {
  scheme: 'exact',
  network: SOLANA_MAINNET,        // CAIP-2 identifier
  asset: USDC_MAINNET,            // SPL mint (base58)
  amount: '1000000',              // 1 USDC, base units
  payTo: '<recipient address>',
  maxTimeoutSeconds: 60,
  extra: { nonce: '<nonce from the 402 response>' }, // required; issued by the facilitator
};

// Payer side: build + sign + send the transfer, get the proof.
// Throws InvalidInputError (nothing sent) without a nonce or with a non-integer amount,
// and MissingTokenAccountError when the wallet holds none of the asset.
const proof = await payExact(agent.wallet, agent.connection, requirements);

// Wrap it into an x402 v2 PaymentPayload for the X-PAYMENT header retry.
const payload = buildExactPaymentPayload(requirements, proof, 'https://api.example/thing');
```

Receiver / facilitator side:

```js
import { ExactFacilitator } from '@three-ws/solana-agent/x402-exact';

const facilitator = new ExactFacilitator('https://api.mainnet-beta.solana.com'); // RPC URL
const { nonce } = await facilitator.issueChallenge({ resource: '/api/thing', asset, amount, payTo });
// ...send `nonce` in requirements.extra.nonce with the 402, then on the retry:
const verify = await facilitator.verify(proof, requirements);  // VerifyResponse { isValid, ... }
const settle = await facilitator.settle(proof, requirements);  // SettleResponse { success, ... }
```

Types: `ExactPaymentRequirements` (`scheme`, `network`, `asset`, `amount`, `payTo`, `maxTimeoutSeconds`, `extra?`), `ExactPaymentProof` (`signature`, `network`), `VerifyResponse`, `SettleResponse`. Constants: `SOLANA_MAINNET`, `SOLANA_DEVNET`, `USDC_MAINNET`, `USDC_DEVNET`.

## solana-agent-kit plugin

For [solana-agent-kit](https://github.com/sendaifun/solana-agent-kit) v2, register the plugin. This entry point needs `zod` installed (the `Action` tool-call schemas are zod schemas, per the solana-agent-kit contract):

```js
import { SolanaAgentKit } from 'solana-agent-kit';
import { SolanaAgentPlugin } from '@three-ws/solana-agent/solana-agent-kit';

const kit = new SolanaAgentKit(privateKey, rpcUrl, {});
kit.use(SolanaAgentPlugin);
```

Or drive the `Action` definitions directly against a `SolanaAgent`:

```js
import { SolanaAgent } from '@three-ws/solana-agent';
import { swapAction, allActions } from '@three-ws/solana-agent/solana-agent-kit';

const agent = SolanaAgent.fromKeypair(key, rpcUrl);
const result = await swapAction.handler(agent, { inputMint, outputMint, amount });
```

Exports here: `SolanaAgentPlugin`, `allActions`, the individual actions (`transferSolAction`, `transferSplAction`, `swapAction`, `getSwapQuoteAction`, `getBalanceAction`, `createAtaAction`, `stakeSolAction`, `unstakeSolAction`, `getStakeAccountsAction`), and the `Action` / `Plugin` / `SolanaAgentLike` types.

## AgenC coordination

The root export also bundles an adapter for the [AgenC](https://agenc.tech)
on-chain agent-coordination protocol — register agents, create and claim tasks,
and bridge identities from ERC-8004 / MPL-Core / three.ws handles into AgenC ids.

```js
import {
  createAgenCClient,
  registerAgenCAgent,
  createAgenCTask,
  claimAgenCTask,
  completeAgenCTask,
} from '@three-ws/solana-agent';
```

Also exported: `getAgenCAgent`, `deriveAgenCAgentPda`, the task lifecycle helpers
(`getAgenCTask`, `getAgenCTaskLifecycle`, `listAgenCTasksByCreator`,
`generateAgenCTaskId`, `formatTaskState`), the identity bridges
(`bridgeErc8004ToAgenCId`, `bridgeMplCoreToAgenCId`, `bridgeThreewsHandleToAgenCId`,
`getCanonicalThreewsAgenCId`), and the program-id constants
(`AGENC_DEVNET_PROGRAM_ID`, `AGENC_MAINNET_PROGRAM_ID`).

## Provably-fair vanity wallets

`grindVerifiedVanity` requests a vanity address from the three.ws
`/api/x402/vanity-verifiable` endpoint, opens the ECIES-sealed secret locally,
and independently verifies every claim in the signed receipt before handing
you the key. It throws `ReceiptVerificationError` (with one entry per failed
check in `failures`) instead of returning a key that fails verification, and
`RequestFailedError` when the paid request itself is refused.

```js
import { grindVerifiedVanity, verifyVanityReceipt } from '@three-ws/solana-agent/vanity';

const { address, secretKeyBase58, receipt } = await grindVerifiedVanity({
  prefix: 'abc',
  fetchImpl: paywallFetch,   // x402-capable fetch (e.g. wrapFetchWithPayment)
});

// The receipt is portable: anyone can re-verify it later.
const check = await verifyVanityReceipt(receipt);
```

Also exported: the verifier internals (`verifyVanityReceipt`, `verifyReceiptSignature`, `commitToSeed`, `deriveMasterSeed`, `candidateSeed`, `candidateAddress`, `addressMatchesPattern`, `expectedAttempts`, `fetchServiceKey`), the sealed-envelope helpers (`openSealed`, `openSealedJson`, `generateRecipientKeypair`, `SEALED_ENVELOPE_SCHEME`), and the protocol constants (`VANITY_PROTOCOL_VERSION`, `THREE_VANITY_SERVICE_KEY`, `THREE_VANITY_WELL_KNOWN`, `THREE_VANITY_ENDPOINT`).

## Errors

Everything the SDK throws on purpose is a `SolanaAgentError` subclass, exported from the root. Branch on the class, not the message:

```js
import { TransactionFailedError, RetriesExhaustedError, InvalidInputError } from '@three-ws/solana-agent';

try {
  await agent.transferSpl(mint, to, amount);
} catch (err) {
  if (err instanceof InvalidInputError) showFieldError(err.param, err.message);
  else if (err instanceof TransactionFailedError) reportOnChainFailure(err.signature, err.transactionError);
  else if (err instanceof RetriesExhaustedError) offerRetry();
  else throw err;
}
```

| Class | Thrown when | Fields |
| --- | --- | --- |
| `SolanaAgentError` | base class of every error below | |
| `TransactionRejectedError` | the user rejected a browser-wallet prompt, or approval timed out | `reason` |
| `WalletNotConnectedError` | a wallet adapter has no `publicKey` | |
| `WalletCapabilityError` | a wallet adapter lacks `signTransaction` or `sendTransaction` | `capability` |
| `MissingTokenAccountError` | the sender holds no token account for the mint | `mint`, `owner` |
| `SwapError` | a Jupiter quote or swap request failed, or the swap transaction does not match its quote | `inputMint`, `outputMint` |
| `SimulationError` | preflight simulation failed before sending | `simulationError` |
| `ConfirmationTimeoutError` | the signature did not reach the commitment within `timeoutMs` | `signature`, `timeoutMs` |
| `TransactionFailedError` | the transaction landed but its execution failed | `signature`, `transactionError` |
| `RetriesExhaustedError` | every attempt's blockhash expired before it landed | `attempts`, `lastBlockhash`, `lastError` |
| `LookupTableNotFoundError` | a referenced address lookup table does not exist | `address` |
| `MintNotFoundError` | a mint account does not exist | `mint` |
| `NotATokenMintError` | an account passed as a mint is owned by neither SPL token program | `mint`, `owner` |
| `InvalidInputError` | a caller-supplied argument is malformed or out of range; nothing was sent | `param` |
| `RequestFailedError` | a three.ws HTTP endpoint returned a non-2xx status | `url`, `status`, `detail` |
| `ReceiptVerificationError` | a vanity receipt failed independent verification | `failures` |

A blockhash that expired mid-confirmation surfaces as web3.js's own `TransactionExpiredBlockheightExceededError`; `buildAndSend` catches it and retries, so callers of the actions see `RetriesExhaustedError` instead.

`err.name` is the class name even in the minified build, and `instanceof` holds across the separately bundled entry points (`/wallet`, `/x402-exact`, `/vanity`), so an error thrown inside one subpath matches the class imported from the root. A plain `Error` that merely copies a `name` never matches. Your own subclasses of `SolanaAgentError` keep their own name.

## Requirements

- **Node** `>= 18`.
- **Base dep:** `@solana/web3.js@^1.98`. `@solana/spl-token` and
  `@coral-xyz/anchor` ship as direct dependencies; `zod` is an optional peer dep
  (required only when importing `/solana-agent-kit`).
- For browser signing, a `@solana/wallet-adapter` wallet or a user-supplied
  `SignerFn`.

## Links

- Homepage: https://three.ws
- Changelog: https://three.ws/changelog
- Sibling SDK: [`@three-ws/agent-payments`](https://www.npmjs.com/package/@three-ws/agent-payments)
- Issues: https://github.com/nirholas/three.ws/issues
- License: proprietary, all rights reserved. See [LICENSE](./LICENSE).

---

<p align="center">
  <sub>
    Part of the <a href="https://three.ws">three.ws</a> SDK suite: 3D AI agents, on-chain identity, and agent payments.<br/>
    <a href="https://three.ws">Website</a> · <a href="https://three.ws/changelog">Changelog</a> · <a href="https://github.com/nirholas/three.ws">GitHub</a>
  </sub>
</p>
