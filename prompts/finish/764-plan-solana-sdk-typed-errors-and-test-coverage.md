# The Solana agent SDK throws its typed errors everywhere it should and every shipped action has tests

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/764-plan-solana-sdk-typed-errors-and-test-coverage.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 35 of 100 inside the tier). **Area:** solana. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

`@three-ws/solana-agent` (`solana-agent-sdk/`) shipped almost everything in its `tasks/` folder (Token-2022, memo, staking, versioned transactions, wallet adapter, the bigint and ATA fixes). What is left is the quality tail: three error classes are exported but never thrown, several code paths throw bare `Error`, and most of the surface has no tests. Integrators catching `WalletNotConnectedError` or `ConfirmationTimeoutError` today never see them.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `solana-agent-sdk/src/errors.ts` defines `SolanaAgentError`, `TransactionRejectedError`, `WalletNotConnectedError`, `WalletCapabilityError`, `MissingTokenAccountError`, `SwapError`, `SimulationError`, `ConfirmationTimeoutError`, all re-exported from `src/index.ts`.
- Unused: `WalletNotConnectedError`, `WalletCapabilityError` and `ConfirmationTimeoutError` are never thrown inside `src/`.
- Generic `Error` still thrown in `src/wallet/wallet-adapter.ts` (lines ~20 and ~25: "Wallet not connected", "Wallet does not support signTransaction"), `src/tx/build.ts` (exhausted retries, lookup table not found), `src/actions/stake.ts` ("stakeSOL: exhausted retries").
- Existing tests (`npm test` in `solana-agent-sdk`, jest, 59 passing on 2026-11-03): `tests/agent.test.ts`, `tests/actions/{swap,ata,transfer-spl,transfer-sol}.test.ts`, `tests/wallet/{keypair,browser-client,browser-server}.test.ts`, `tests/vanity/crypto-primitives.test.ts`.
- No tests for: `src/actions/stake.ts`, `get-token-balance.ts`, `get-token-accounts.ts`, `swap-guard.ts`, `src/utils/memo.ts`, `src/utils/token-program.ts`, `src/utils/format.ts`, `src/tx/{build,fees}.ts`, `src/wallet/wallet-adapter.ts`, `src/errors.ts`.
- A separate open order (`458-auto-solana-agent-sdk-zod-cve.md`) covers the zod dependency; this order does not touch dependencies.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd solana-agent-sdk
npm test 2>&1 | tail -8
grep -rn "new Error(" src --include=*.ts | grep -v solana-agent-kit
grep -rn "WalletNotConnectedError\|WalletCapabilityError\|ConfirmationTimeoutError" src | grep -v "errors.ts\|index.ts"
ls tests tests/actions tests/wallet
npm run typecheck
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test-first: for each gap below write the failing test first, run it and confirm it fails for the stated reason, then change the source.
2. `src/wallet/wallet-adapter.ts`: throw `WalletNotConnectedError` when `publicKey` is null and `WalletCapabilityError("signTransaction")` (and the other capabilities the adapter checks) when the adapter lacks a method. Tests in `tests/wallet/wallet-adapter.test.ts` with a fake adapter object implementing the `@solana/wallet-adapter-base` shape (a hand-written adapter double is fine; no network).
3. `src/tx/build.ts` and `src/actions/stake.ts`: when confirmation does not land inside the configured timeout, throw `ConfirmationTimeoutError(signature, timeoutMs)`; replace "exhausted retries" with a typed error carrying the last blockhash/expiry cause (add a `RetriesExhaustedError extends SolanaAgentError` to `errors.ts` and export it). Replace the bare lookup-table `Error` with a typed `LookupTableNotFoundError`. Tests with a `Connection` stub whose `confirmTransaction` and `getAddressLookupTable` return controlled results.
4. Add tests (jest, beside the existing ones) for the untested modules listed above: `stake` (builds the stake account + delegate instructions, rejects below rent-exempt minimum), `get-token-balance` and `get-token-accounts` (Token and Token-2022 program ids, zero-balance accounts, decimals handling), `swap-guard` (each `SwapError` branch, including the unresolvable lookup table), `utils/memo` (instruction data, 566-byte limit if the source enforces one), `utils/token-program` (classic vs Token-2022 detection), `utils/format` (`toUiAmount` rounding and bigint safety on values above 2^53), `tx/fees` (`SimulationError` on a failing simulation, compute-unit fallback), `errors.ts` (names, fields, `instanceof SolanaAgentError`).
5. Run the suite with coverage (`npx jest --coverage`) and record the before/after line coverage for `src/actions`, `src/tx`, `src/wallet`, `src/utils`.
6. Update `solana-agent-sdk/README.md` with an "Errors" section listing every exported error class and when it is thrown. Add a `CHANGELOG`/version note consistent with the package's existing convention (read `package.json` and any CHANGELOG first). Add a `data/changelog.json` entry only if the package is published and user-visible; otherwise say why not in the report.
7. Delete `solana-agent-sdk/tasks/*.md` files whose work is verified shipped, or replace the folder with a one-paragraph README pointing to the tests. Verify each against the code before deleting.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `cd solana-agent-sdk && npm test` passes with strictly more tests than the 59 baseline, and `npm run typecheck` is clean.
- [ ] `grep -rn "new Error(" solana-agent-sdk/src --include=*.ts | grep -v solana-agent-kit` returns no lines (every throw is a `SolanaAgentError` subclass), or each remaining one is justified in a comment.
- [ ] `grep -rn "WalletNotConnectedError\|WalletCapabilityError\|ConfirmationTimeoutError" solana-agent-sdk/src` shows a throw site for each outside `errors.ts` and `index.ts`.
- [ ] Each of the new error paths has a test that was observed failing before the source change.
- [ ] Coverage numbers before and after are in the report.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No devnet RPC reachable from the sandbox | Tests use `Connection` stubs with controlled return values; add one optional devnet smoke test guarded by an env var and skipped by default, never required to pass. |
| jest ESM flag errors | Use the package's own `npm test` script (`node --experimental-vm-modules`); do not invoke `jest` directly. |
| `ts` build artefacts missing | `npm run build` first; tests run against `src`, so this is only needed for the typecheck of `dist` types. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/764-plan-solana-sdk-typed-errors-and-test-coverage.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `764-plan-solana-sdk-typed-errors-and-test-coverage.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `solana-agent-sdk/README.md` (whole file)

~~~~markdown
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

> A typed Solana SDK for AI agents. Give an agent a wallet - its own keypair for
> autonomous signing, or a browser wallet that defers signing to the user - then
> transfer SOL and SPL tokens, swap via Jupiter, stake, pay x402 invoices in USDC,
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
| `@three-ws/solana-agent/x402-exact` | the x402 "exact" USDC payment scheme (payer + facilitator) |
| `@three-ws/solana-agent/solana-agent-kit` | a `solana-agent-kit` plugin and tool-call `Action` definitions |
| `@three-ws/solana-agent/vanity` | provably-fair vanity wallet grinding: one-call client, receipt verifier, sealed-envelope opener |

## Quick start

`SolanaAgent` is the main entry. Use the static factories - `fromKeypair` (the agent holds the key and signs autonomously) or `fromBrowserWallet` (signing is deferred to the user's wallet).

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

// Token balances / accounts.
const bal = await agent.getTokenBalance('<mint>');   // null if no account for that mint
const accounts = await agent.getTokenAccounts();      // non-zero balances only

// Associated token account.
const { address, created } = await agent.getOrCreateAta({ mint: '<mint>' });

// Staking.
await agent.stakeSOL('<voteAccount>', 1);             // amount in SOL
await agent.unstakeSOL('<stakeAccount>');             // withdrawable after ~1 epoch
const stakes = await agent.getStakeAccounts();
```

The underlying functions (`transferSol`, `transferSpl`, `jupiterSwap`, `getSwapQuote`, `getTokenBalance`, `getTokenAccounts`, `getOrCreateAta`, `stakeSOL`, `unstakeSOL`, `getStakeAccounts`) and the `SOL_MINT` constant are also exported from the root for functional use.

## Wallet providers

All implement the same `WalletProvider` interface, so they are interchangeable in `new SolanaAgent({ wallet, connection })`:

- `KeypairWalletProvider` - server-side keypair. `new KeypairWalletProvider(privateKey)` accepts a base58 string, `Uint8Array`, or `number[]`.
- `BrowserWalletProvider` - server half of a split browser-signing flow (`createHandler()` mounts on your HTTP server).
- `BrowserWalletClient` - browser half; signs via a user-supplied `SignerFn` with an `ApprovalHandler`.
- `WalletAdapterProvider` - wraps a `@solana/wallet-adapter` wallet.

`isMetaAware()` plus the `TxMetadata` / `MetaAwareWallet` types support attaching memo/metadata to transactions.

## x402 exact payments

The `exact` scheme transfers a fixed USDC amount via an SPL `TransferChecked` and returns the tx signature as the proof for an x402 `X-PAYMENT` header. Compatible with x402 v2.

```js
import { payExact, buildExactPaymentPayload, USDC_MAINNET, SOLANA_MAINNET } from '@three-ws/solana-agent/x402-exact';

const requirements = {
  scheme: 'exact',
  network: SOLANA_MAINNET,        // CAIP-2 identifier
  asset: USDC_MAINNET,            // SPL mint (base58)
  amount: '1000000',              // 1 USDC, base units
  payTo: '<recipient address>',
  maxTimeoutSeconds: 60,
};

// Payer side: build + sign + send the transfer, get the proof.
const proof = await payExact(agent.wallet, agent.connection, requirements);

// Wrap it into an x402 v2 PaymentPayload for the X-PAYMENT header retry.
const payload = buildExactPaymentPayload(requirements, proof, 'https://api.example/thing');
```

Receiver / facilitator side:

```js
import { ExactFacilitator } from '@three-ws/solana-agent/x402-exact';

const facilitator = new ExactFacilitator('https://api.mainnet-beta.solana.com'); // RPC URL
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
on-chain agent-coordination protocol - register agents, create and claim tasks,
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
you the key. It throws instead of returning a key that fails verification.

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

Typed error classes (exported from the root) for boundary handling: `SolanaAgentError`, `TransactionRejectedError`, `WalletNotConnectedError`, `WalletCapabilityError`, `MissingTokenAccountError`, `SwapError`, `SimulationError`, `ConfirmationTimeoutError`.

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
    Part of the <a href="https://three.ws">three.ws</a> SDK suite - 3D AI agents, on-chain identity, and agent payments.<br/>
    <a href="https://three.ws">Website</a> · <a href="https://three.ws/changelog">Changelog</a> · <a href="https://github.com/nirholas/three.ws">GitHub</a>
  </sub>
</p>
~~~~

### `solana-agent-sdk/tasks/add-custom-errors.md` (whole file)

~~~~markdown
# Feature: Custom error classes

## Context

`/workspaces/3D-Agent/solana-agent-sdk` is a TypeScript Solana agent SDK (`@three-ws/solana-agent`).
Build command: `cd /workspaces/3D-Agent/solana-agent-sdk && npm run build`
The build must pass with zero errors before this task is complete.

## What to Build

The SDK currently throws generic `Error` everywhere. Consumers can't programmatically distinguish "user rejected" from "insufficient funds" from "RPC error". Add custom error classes so consumers can write:

```ts
try {
  await agent.swap(...);
} catch (err) {
  if (err instanceof TransactionRejectedError) showRejectedToast();
  if (err instanceof InsufficientFundsError) showFundsError(err.required, err.available);
  if (err instanceof SwapError) showSwapError(err.quote);
}
```

## Implementation

### `src/errors.ts`

Create this file with the following error classes:

```ts
/** Base class for all @three-ws/solana-agent errors */
export class SolanaAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** Thrown when a transaction is rejected by the user (browser wallet) or timed out waiting for approval */
export class TransactionRejectedError extends SolanaAgentError {
  constructor(public readonly reason: string = "User rejected") {
    super(`Transaction rejected: ${reason}`);
  }
}

/** Thrown when a wallet is not connected (WalletAdapterProvider with null publicKey) */
export class WalletNotConnectedError extends SolanaAgentError {
  constructor() {
    super("Wallet is not connected");
  }
}

/** Thrown when a wallet adapter does not support a required operation */
export class WalletCapabilityError extends SolanaAgentError {
  constructor(public readonly capability: string) {
    super(`Wallet does not support: ${capability}`);
  }
}

/** Thrown when a sender has no token account for the given mint */
export class MissingTokenAccountError extends SolanaAgentError {
  constructor(public readonly mint: string, public readonly owner: string) {
    super(`No token account for mint ${mint} owned by ${owner}`);
  }
}

/** Thrown when a Jupiter swap quote or swap request fails */
export class SwapError extends SolanaAgentError {
  constructor(
    message: string,
    public readonly inputMint?: string,
    public readonly outputMint?: string,
  ) {
    super(message);
  }
}

/** Thrown when transaction simulation fails before submission */
export class SimulationError extends SolanaAgentError {
  constructor(public readonly simulationError: unknown) {
    super(`Transaction simulation failed: ${JSON.stringify(simulationError)}`);
  }
}

/** Thrown when a transaction is not confirmed within the timeout period */
export class ConfirmationTimeoutError extends SolanaAgentError {
  constructor(public readonly signature: string, public readonly timeoutMs: number) {
    super(`Transaction ${signature} not confirmed within ${timeoutMs}ms`);
  }
}
```

### Update existing code to use custom errors

Update these locations to throw custom errors instead of generic `Error`:

**`src/wallet/browser-server.ts`:**
- Timeout: `throw new TransactionRejectedError("Timed out waiting for user approval")` (import `TransactionRejectedError`)
- User rejected: `throw new TransactionRejectedError("User rejected")`

**`src/actions/transfer-spl.ts`** (after fix-sender-ata-missing.md is applied, or add it now):
- No sender ATA: `throw new MissingTokenAccountError(mint.toBase58(), wallet.publicKey.toBase58())`

**`src/tx/fees.ts`** (after fix-cu-fallback.md is applied, or add it now):
- Simulation error: `throw new SimulationError(sim.value.err)`

**`src/actions/swap.ts`:**
- Jupiter quote fail: `throw new SwapError(\`Jupiter quote failed: ${await res.text()}\`, inputMint, outputMint)`
- Jupiter swap fail: `throw new SwapError(\`Jupiter swap failed: ${await res.text()}\`, inputMint, outputMint)`

### Export

**`src/index.ts`** - add:
```ts
export {
  SolanaAgentError,
  TransactionRejectedError,
  WalletNotConnectedError,
  WalletCapabilityError,
  MissingTokenAccountError,
  SwapError,
  SimulationError,
  ConfirmationTimeoutError,
} from "./errors.js";
```

## Verification

1. `npm run build` passes with zero errors
2. All error classes are exported from the main package entry point
3. `new TransactionRejectedError() instanceof SolanaAgentError` is `true`
4. `new TransactionRejectedError() instanceof Error` is `true`
5. Error `name` property matches the class name (not "Error")
6. At minimum `browser-server.ts` uses `TransactionRejectedError` instead of generic `Error`
~~~~

### `solana-agent-sdk/tasks/add-tests-actions.md` (whole file)

~~~~markdown
# Tests: Unit tests for action functions

## Context

`/workspaces/3D-Agent/solana-agent-sdk` is a TypeScript Solana agent SDK (`@three-ws/solana-agent`).
Package location: `/workspaces/3D-Agent/solana-agent-sdk/`

The existing `agent-payments-sdk` package uses Jest (`jest.config.ts`, `ts-jest`). This package has no tests yet. Use the same stack.

Install test dependencies:
```bash
cd /workspaces/3D-Agent/solana-agent-sdk
npm install --save-dev jest ts-jest @types/jest
```

Add to `package.json` scripts:
```json
"test": "node --experimental-vm-modules node_modules/.bin/jest"
```

Create `jest.config.ts`:
```ts
import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true }],
  },
};

export default config;
```

## What to Test

Create `tests/actions/` directory with these test files. All tests must be fully self-contained - mock RPC calls, do not hit mainnet/devnet.

### `tests/actions/transfer-sol.test.ts`

Test `transferSol` from `src/actions/transfer-sol.ts`.

Mock `buildAndSend` to capture what it receives. The tests should verify:

1. **Correct lamport conversion**: `amount: 0.5` → `lamports = 500_000_000`
2. **Correct instruction**: `SystemProgram.transfer` instruction is built with correct `fromPubkey`, `toPubkey`, `lamports`
3. **Metadata is generated**: `opts.meta.label` contains the amount and "SOL"
4. **Metadata kind**: `opts.meta.kind === "transfer"`
5. **String address accepted**: passing `to` as a base58 string works the same as `PublicKey`
6. **Custom meta override**: if `opts.meta` is provided, it's used instead of auto-generated

Use a mock `WalletProvider` with a fixed public key.

### `tests/actions/transfer-spl.test.ts`

Test `transferSpl` from `src/actions/transfer-spl.ts`.

Mock `connection.getAccountInfo`, `connection.getMint` (via `getMint` from spl-token), and `buildAndSend`.

Tests:
1. **Receiver ATA creation**: when `getAccountInfo(receiverAta)` returns null, a `createAssociatedTokenAccountInstruction` is added
2. **No receiver ATA creation**: when receiver ATA exists, no creation instruction
3. **Sender ATA check**: when `getAccountInfo(senderAta)` returns null, throws an error containing "no token account"
4. **TransferChecked instruction**: correct `senderAta`, `mint`, `receiverAta`, `authority`, `amount`, `decimals`
5. **BigInt metadata**: `uiAmount` is correct string - no `Number(bigint)` precision loss

### `tests/actions/swap.test.ts`

Test `jupiterSwap` and `getSwapQuote` from `src/actions/swap.ts`.

Mock `global.fetch` to return controlled Jupiter API responses.

Tests:
1. **Quote fetch**: correct URL is constructed with `inputMint`, `outputMint`, `amount`, `slippageBps`
2. **Default slippage**: when not provided, defaults to 50 bps
3. **Swap request**: correct POST body `{ quoteResponse, userPublicKey, dynamicComputeUnitLimit: true, prioritizationFeeLamports: "auto" }`
4. **Quote error**: when quote API returns non-200, throws `Error` (or `SwapError` if custom errors task is done)
5. **Swap error**: when swap API returns non-200, throws `Error`
6. **Metadata on MetaAwareWallet**: when wallet implements `setNextMeta`, it's called with a swap metadata object including `kind: "swap"`, `amountIn`, `amountOut`
7. **Non-MetaAware wallet**: when wallet doesn't implement `setNextMeta`, no error is thrown

### `tests/actions/ata.test.ts`

Test `getOrCreateAta` from `src/actions/ata.ts`.

Tests:
1. **ATA already exists**: returns `{ ata, signature: undefined }` when `getAccountInfo` returns data
2. **ATA doesn't exist**: builds `createAssociatedTokenAccountInstruction`, calls `buildAndSend`, returns `{ ata, signature: "fakeSig" }`
3. **Default owner**: when `owner` not provided, uses `wallet.publicKey`
4. **Custom owner**: when `owner` is provided, uses that address

## Verification

1. `npm run build` passes with zero errors
2. `npm test` passes with all tests green
3. No test hits an external network (all RPC calls are mocked)
4. Test files are in `tests/` directory, not `src/`
~~~~

### `solana-agent-sdk/tasks/add-tests-wallet-providers.md` (whole file)

~~~~markdown
# Tests: Unit tests for wallet providers

## Context

`/workspaces/3D-Agent/solana-agent-sdk` is a TypeScript Solana agent SDK (`@three-ws/solana-agent`).
Package location: `/workspaces/3D-Agent/solana-agent-sdk/`

If Jest is not yet set up, install it:
```bash
cd /workspaces/3D-Agent/solana-agent-sdk
npm install --save-dev jest ts-jest @types/jest
```

`jest.config.ts` (create if missing):
```ts
import type { Config } from "jest";
const config: Config = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  transform: { "^.+\\.ts$": ["ts-jest", { useESM: true }] },
};
export default config;
```

`package.json` scripts: `"test": "node --experimental-vm-modules node_modules/.bin/jest"`

The wallet provider source files are in `src/wallet/`:
- `keypair.ts` - `KeypairWalletProvider`
- `browser-server.ts` - `BrowserWalletProvider`
- `browser-client.ts` - `BrowserWalletClient`

## What to Test

Create `tests/wallet/` directory.

### `tests/wallet/keypair.test.ts`

Test `KeypairWalletProvider`.

Generate a test keypair using `Keypair.generate()` from `@solana/web3.js`.

Tests:
1. **Base58 string constructor**: `new KeypairWalletProvider(bs58EncodedKey)` sets correct `publicKey`
2. **Uint8Array constructor**: `new KeypairWalletProvider(keypair.secretKey)` sets correct `publicKey`
3. **Array constructor**: `new KeypairWalletProvider(Array.from(keypair.secretKey))` sets correct `publicKey`
4. **signTransaction (legacy)**: signs a `Transaction`, result has a signature for the keypair's public key
5. **signTransaction (versioned)**: signs a `VersionedTransaction`, result `signatures` array is non-empty
6. **signAndSendTransaction**: mocks `sendAndConfirmTransaction` to return `"fakeSig"`, verifies it's called with the keypair

For test 6, mock the module:
```ts
jest.mock("@solana/web3.js", () => ({
  ...jest.requireActual("@solana/web3.js"),
  sendAndConfirmTransaction: jest.fn().mockResolvedValue("fakeSig"),
}));
```

### `tests/wallet/browser-server.test.ts`

Test `BrowserWalletProvider`.

Tests:
1. **Constructor defaults**: `sessionId` is a UUID string, `publicKey` is set from options
2. **String publicKey**: constructor accepts base58 string, converts to `PublicKey`
3. **setNextMeta**: calling `setNextMeta(meta)` then `signTransaction` attaches `meta` to the pending tx
4. **signTransaction creates pending entry**: after calling `signTransaction`, `getPending()` has one entry
5. **signTransaction pending has correct fields**: `id`, `transaction` (base64), `versioned`, `createdAt`, `meta`
6. **submitSigned resolves the promise**: calling `submitSigned(id, signedBase64)` resolves the pending `signTransaction` promise
7. **submitRejected rejects the promise**: calling `submitRejected(id)` rejects with an error containing "rejected"
8. **timeout**: if neither `submitSigned` nor `submitRejected` is called within `timeoutMs`, the promise rejects with "timed out"
9. **meta consumed once**: after one `signTransaction` call, `nextMeta` is cleared; a second call has `meta: undefined`

For test 8, use a short `timeoutMs` (e.g. 50ms) and `jest.useFakeTimers()`.

For test 6, build a valid signed transaction:
```ts
const tx = new Transaction();
tx.recentBlockhash = "11111111111111111111111111111111";
tx.feePayer = Keypair.generate().publicKey;
const signed = Buffer.from(tx.serialize({ requireAllSignatures: false })).toString("base64");
```

### `tests/wallet/browser-client.test.ts`

Test `BrowserWalletClient`. This file runs in Node.js but `BrowserWalletClient` uses `EventSource` and browser globals (`fetch`, `atob`, `btoa`). Mock them.

Setup:
```ts
global.fetch = jest.fn();
global.EventSource = jest.fn().mockImplementation((url: string) => ({
  onmessage: null,
  onerror: null,
  close: jest.fn(),
})) as any;
```

Tests:
1. **connect() opens EventSource**: after `client.connect()`, `EventSource` constructor was called with `baseUrl + "/stream"`
2. **disconnect() closes EventSource**: after connect then disconnect, `close()` is called
3. **onmessage triggers signing**: simulate a message event with a pending tx; verify `signer` is called
4. **auto-sign without onApproval**: signer is called immediately when a message arrives (no approval step)
5. **onApproval blocks signing**: when `onApproval` is provided, signer is NOT called until `approve()` is invoked
6. **onApproval reject path**: calling `reject()` in handler calls `fetch` to the `/reject/:id` endpoint, signer is NOT called
7. **onConfirmed fires**: when the sign POST returns `{ ok: true, signature: "abc" }`, `onConfirmed` is called with the pending tx and `"abc"`
8. **reconnect on error**: simulate `onerror`, verify a new `EventSource` is created after `reconnectMs`

Use `jest.useFakeTimers()` for test 8.

## Verification

1. `npm run build` passes
2. `npm test` passes - all tests green
3. No test uses real network connections
4. `tests/wallet/` contains three test files
~~~~

### `solana-agent-sdk/tasks/add-token-balance-methods.md` (whole file)

~~~~markdown
# Feature: `getTokenBalance` and `getTokenAccounts` on `SolanaAgent`

## Context

`/workspaces/3D-Agent/solana-agent-sdk` is a TypeScript Solana agent SDK (`@three-ws/solana-agent`).
Build command: `cd /workspaces/3D-Agent/solana-agent-sdk && npm run build`
The build must pass with zero errors before this task is complete.

`src/agent.ts` contains the `SolanaAgent` class. It currently has:
- `getBalance()` - returns SOL balance in lamports
- `transferSol()`, `transferSpl()`, `swap()`, `getOrCreateAta()`

It is missing basic token balance reads.

## What to Build

Add two methods to `SolanaAgent` and two standalone functions to `src/actions/`:

### Standalone functions

**`src/actions/get-token-balance.ts`**

```ts
export interface TokenBalanceResult {
  mint: string;
  amount: string;       // raw base units
  decimals: number;
  uiAmount: string;     // human readable
  ata: string;          // ATA address
}

export async function getTokenBalance(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey | string,
): Promise<TokenBalanceResult | null>
```

- Derives the ATA for `owner` + `mint`
- Fetches the token account via `connection.getTokenAccountBalance(ata)`
- Returns `null` if the account doesn't exist (not an error)
- Returns `TokenBalanceResult` with all fields populated
- `uiAmount` should use BigInt-safe division (same pattern as `fix-bigint-precision-swap.md` recommends - `whole.frac` string format, no `Number()` on large values)

**`src/actions/get-token-accounts.ts`**

```ts
export interface TokenAccount {
  mint: string;
  ata: string;
  amount: string;       // raw base units
  decimals: number;
  uiAmount: string;
}

export async function getTokenAccounts(
  connection: Connection,
  owner: PublicKey,
): Promise<TokenAccount[]>
```

- Uses `connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID })`
- Returns all token accounts with non-zero balance
- Filters out zero-balance accounts
- Uses `@solana/spl-token`'s `TOKEN_PROGRAM_ID` for the filter
- `uiAmount` uses BigInt-safe division

### `src/actions/index.ts`

Add exports:
```ts
export { getTokenBalance } from "./get-token-balance.js";
export type { TokenBalanceResult } from "./get-token-balance.js";
export { getTokenAccounts } from "./get-token-accounts.js";
export type { TokenAccount } from "./get-token-accounts.js";
```

### `src/agent.ts`

Add two methods:

```ts
/** Get SPL token balance. Returns null if the wallet has no account for that mint. */
getTokenBalance(mint: PublicKey | string): Promise<TokenBalanceResult | null> {
  return getTokenBalance(this.connection, this.wallet.publicKey, mint);
}

/** List all SPL token accounts with non-zero balance. */
getTokenAccounts(): Promise<TokenAccount[]> {
  return getTokenAccounts(this.connection, this.wallet.publicKey);
}
```

Import the functions at the top of `agent.ts`.

### `src/index.ts`

Add exports for the new types and functions:
```ts
export { getTokenBalance } from "./actions/get-token-balance.js";
export type { TokenBalanceResult } from "./actions/get-token-balance.js";
export { getTokenAccounts } from "./actions/get-token-accounts.js";
export type { TokenAccount } from "./actions/get-token-accounts.js";
```

## Verification

1. `npm run build` passes with zero errors
2. `SolanaAgent` has both `getTokenBalance(mint)` and `getTokenAccounts()` methods
3. Both standalone functions are exported from the main index
4. `getTokenBalance` returns `null` (not an error) when the ATA doesn't exist
5. `uiAmount` fields use BigInt-safe arithmetic - no `Number(bigint)`
~~~~

