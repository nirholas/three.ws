# Robinhood Chain USDG becomes an accepted x402 rail through hood402, behind an env flag

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/756-plan-robinhood-hood402-x402-payment-rail.md`.

**Priority:** P2, new capability with clear value (score 30 of 100 inside the tier). **Area:** robinhood. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

`robinhood/hood402/INTEGRATION.md` is a written plan, never executed, for adding `network: robinhood-chain` (CAIP-2 `eip155:4663`, testnet `eip155:46630`) to the platform's x402 accepts list using the published `hood402` package (npm 0.1.1). Today `api/_lib/x402-spec.js` advertises Solana first, then Base, BSC and X Layer, and nothing for Robinhood Chain (Robinhood Crypto only). Landing it gives any x402 client an additional USDG rail. Solana stays first in the accepts order and nothing about the Solana lane changes.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `api/_lib/x402-spec.js`: `X402_VERSION = 2`; `NETWORK_*` constants at lines 122-126 (no Robinhood); `DIRECT_NETWORKS = new Set([NETWORK_BSC_MAINNET])` at line 144; `paymentRequirements()` builds accepts (Solana, Base, BSC, ...); a network dispatch near line 321 handles `DIRECT_NETWORKS`; a facilitator capability probe near line 700-716 hard-checks `x402Version === X402_VERSION`.
- Sibling precedent for a per-network verify/settle module: `api/_lib/x402-xlayer-okx.js` and `api/_lib/x402-bsc-direct.js`.
- `grep -rn hood402 api src` returns nothing; there is no `api/_lib/x402-robinhood.js` and `X402_PAY_TO_ROBINHOOD` is not in `api/_lib/env.js`.
- `robinhood/hood402/` is a reference snapshot (source of truth is the npm package `hood402` and `nirholas/robinhood-chain-*` repos). Import from npm, never via `file:`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
grep -rn "hood402\|X402_PAY_TO_ROBINHOOD\|eip155:4663" api src | head
npm view hood402 version
sed -n 118,146p api/_lib/x402-spec.js
grep -n "DIRECT_NETWORKS\|x402Version" api/_lib/x402-spec.js
ls tests | grep -i "x402-spec\|xlayer\|bsc"
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Read `robinhood/hood402/INTEGRATION.md` fully and `robinhood/hood402/README.md`; confirm the exported API of the installed `hood402` (`buildRequirements`, `verifyPayment`, `settlePayment`, `requireNetwork`, `FacilitatorClient`) against the real package, and correct any signature that drifted since the plan was written.
2. Add `hood402` (exact pinned version) to the root `package.json` dependencies. Add env keys to `api/_lib/env.js`: `X402_PAY_TO_ROBINHOOD`, `ROBINHOOD_CHAIN_NETWORK` (default `robinhood`), `ROBINHOOD_CHAIN_RPC_URL`, `ROBINHOOD_FACILITATOR_PRIVATE_KEY` (secret), `ROBINHOOD_FACILITATOR_URL`.
3. Write `api/_lib/x402-robinhood.js` as planned: `robinhoodRequirements`, `verifyRobinhoodPayment`, `settleRobinhoodPayment`, library mode with the standalone-facilitator mode (`FacilitatorClient`) selected when `ROBINHOOD_FACILITATOR_URL` is set. Fail closed: if neither a key nor a facilitator URL is configured, do not advertise the rail.
4. Wire `api/_lib/x402-spec.js`: add `NETWORK_ROBINHOOD_MAINNET = 'eip155:4663'` and `NETWORK_ROBINHOOD_TESTNET = 'eip155:46630'`, add the Robinhood Chain accept (USDG, built through `robinhoodRequirements(...)` so atomics math is not duplicated, translating v1 `maxAmountRequired` to the v2 `amount` field) to `paymentRequirements()` only when `X402_PAY_TO_ROBINHOOD` and a settlement path are configured, place it after Solana, Base and BSC, add it to the direct-settle dispatch so the generic `/supported` probe is skipped for it, and route incoming `X-PAYMENT` payloads with those networks to the new verify/settle functions. Also update `api/_lib/x402-paid-endpoint.js` wherever it branches per network.
5. Tests, real crypto not mocks: `tests/x402-robinhood-rail.test.js`. Sign a genuine EIP-3009 `transferWithAuthorization` typed-data payload with a throwaway viem account and assert `verifyRobinhoodPayment` accepts it, rejects a tampered amount, a wrong `payTo`, an expired window and a reused nonce; assert `paymentRequirements()` omits the rail when unconfigured and includes it (after the Solana accept) when configured; assert the Solana and Base entries are byte-identical to before.
6. Live settlement test, gated and skipped by default: `tests/x402-robinhood-rail.live.test.js` runs only when `ROBINHOOD_CHAIN_PRIVATE_KEY` and testnet USDG are present, settling on testnet 46630 through `settleRobinhoodPayment`.
7. Docs: add the rail and env vars to `docs/x402*.md` (find with `grep -rl "X402_PAY_TO_BSC\|X402_PAY_TO_BASE" docs`), update `robinhood/hood402/INTEGRATION.md` to describe what shipped, `data/changelog.json` entry (user-visible: a new accepted chain), `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/x402-robinhood-rail.test.js` passes, including the tampered-payload and replay cases.
- [ ] With `X402_PAY_TO_ROBINHOOD` unset, `node -e "import('./api/_lib/x402-spec.js').then(m=>console.log(m.paymentRequirements('https://three.ws/x').map(a=>a.network)))"` prints exactly the same list as on `main` before the change.
- [ ] With it set (and a test key), the list gains `eip155:4663` after the Solana entry.
- [ ] `grep -rn "file:.*hood402" package.json` is empty; the dependency is the npm release.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Testnet faucet needs a browser session | Offline verify tests use real signatures and need no chain; the live settle test stays gated and skipped; report it as the single remaining owner step |
| `hood402` v1 payload vs platform v2 shapes | Translate at the module boundary in `x402-robinhood.js`; never change the v2 shape other rails use |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Broadcasting a mainnet settlement transaction or funding the gas key is an on-chain action. Build and test everything on testnet and offline verification; do not enable the rail in production env, and batch any request to do so into one message at the end.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/756-plan-robinhood-hood402-x402-payment-rail.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `756-plan-robinhood-hood402-x402-payment-rail.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `robinhood/hood402/INTEGRATION.md` (whole file)

~~~~markdown
# Integrating hood402 into three.ws's x402 catalog

This describes exactly how to add `network: robinhood-chain` as an accepted rail in
three.ws's existing x402 catalog (`api/_lib/x402-spec.js` + `api/_lib/x402-paid-endpoint.js`),
using this package. **No changes were made to three.ws in this prompt** - this is the plan
for the agent that does that work.

## The two protocol mismatches to reconcile first

three.ws's catalog and hood402 both implement `exact`/EIP-3009, but they encode it
differently on the wire. An integration has to bridge these, not paper over them:

| | three.ws (`x402-spec.js`) | hood402 |
|---|---|---|
| `x402Version` | `2` (`X402_VERSION = 2`, line 81) | `1` |
| Network id | CAIP-2 (`eip155:8453`, `eip155:56`, `solana:5eykt4...`) | Plain string (`robinhood`, `robinhood-testnet`) |
| Price field | `amount` (v2; per `paymentRequirements()`, line 169) | `maxAmountRequired` (v1) |
| Envelope shape | `resource`/`description`/`mimeType` top-level, not per-`accepts` entry | Per-`accepts` entry (v1) |
| Headers | `X-PAYMENT` / `X-PAYMENT-RESPONSE` (+ a `PAYMENT-REQUIRED` mirror for older clients) | `X-PAYMENT` / `X-PAYMENT-RESPONSE` - **same headers, no change needed here** |

The header names already match - that's the easy part. The version number, network id
format, and price field name don't, and three.ws's own facilitator-capability probe
(`x402-spec.js` ~line 716) hard-checks `(k.x402Version ?? 1) === X402_VERSION` - a v1
facilitator's `/supported` response fails that check as written. **This is exactly the kind
of per-network special-case three.ws's code already has a seam for**: see
`DIRECT_NETWORKS = new Set([NETWORK_BSC_MAINNET])` (line 120) and the `selfFacilitatorEnabled()`
/ `selfFacilitatorUrl()` pair - BSC already gets bespoke handling instead of going through
the generic v2 facilitator path. Robinhood Chain should get the same treatment: a small,
explicit special case, not a generic-path retrofit.

## Recommended integration: hood402 as a library, not a second service

three.ws runs one Cloud Run container serving all of `api/**` (see the root `CLAUDE.md`
stack notes). Rather than deploying a separate `hood402-facilitator` process, **import
hood402's `verifyPayment`/`settlePayment`/`buildRequirements` directly** and call them from
a new `api/_lib/x402-robinhood.js` - this is the same shape as three.ws's existing
`selfFacilitatorEnabled()` self-settle path, just using hood402's implementation instead of
reimplementing EIP-3009 verification a second time.

```bash
npm install hood402 viem
```

```js
// api/_lib/x402-robinhood.js - new file, not a modification of x402-spec.js
import {
  buildRequirements,
  verifyPayment,
  settlePayment,
  requireNetwork,
} from 'hood402';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { env } from './env.js';

const net = requireNetwork(env.ROBINHOOD_CHAIN_NETWORK ?? 'robinhood'); // or 'robinhood-testnet'
const transport = http(env.ROBINHOOD_CHAIN_RPC_URL ?? net.rpcUrl);
const reader = createPublicClient({ chain: net.chain, transport });

const account = privateKeyToAccount(env.ROBINHOOD_FACILITATOR_PRIVATE_KEY);
const wallet = createWalletClient({ account, chain: net.chain, transport });

export function robinhoodRequirements(resourceUrl, amountAtomic) {
  return buildRequirements({
    price: { atomic: String(amountAtomic) },
    payTo: env.X402_PAY_TO_ROBINHOOD,
    resource: resourceUrl,
    network: net.id,
  });
}

export async function verifyRobinhoodPayment(paymentPayload, requirements) {
  return verifyPayment({ payload: paymentPayload, requirements, reader });
}

export async function settleRobinhoodPayment(paymentPayload, requirements) {
  return settlePayment({
    payload: paymentPayload,
    requirements,
    wallet,
    account: account.address,
    reader,
  });
}
```

Then in `x402-spec.js`, add a Robinhood Chain branch alongside the existing Base/BSC/Solana
ones - modeled directly on the `env.X402_PAY_TO_BASE` block (line 208) and the
`DIRECT_NETWORKS` special case (line 120):

- Add `NETWORK_ROBINHOOD_MAINNET = 'eip155:4663'` and `NETWORK_ROBINHOOD_TESTNET = 'eip155:46630'`
  next to the existing `NETWORK_*` constants (hood402's `networks.ts` already recognizes
  both of these CAIP-2 strings as aliases for its own `'robinhood'`/`'robinhood-testnet'`
  ids, so passing either form into `buildRequirements`/`requireNetwork` works).
- Add Robinhood Chain to `DIRECT_NETWORKS` (or an equivalent new set) so the generic v2
  facilitator-probe path (`/supported` with the `x402Version === 2` check) is skipped for
  it - verification and settlement route to `verifyRobinhoodPayment`/`settleRobinhoodPayment`
  above instead, exactly like BSC's direct-settlement path.
- In `paymentRequirements()`, push a Robinhood Chain accept entry when
  `env.X402_PAY_TO_ROBINHOOD` is set, translating the v2 `amount` into hood402's
  `maxAmountRequired` via `robinhoodRequirements(resourceUrl, amount).maxAmountRequired`
  rather than duplicating the price-atomics math.
- In the incoming-payment dispatch (wherever `x402-spec.js` currently branches on
  `paymentPayload.network` to route Base vs. BSC vs. Solana verification), add a branch
  for `NETWORK_ROBINHOOD_MAINNET`/`NETWORK_ROBINHOOD_TESTNET` calling
  `verifyRobinhoodPayment`/`settleRobinhoodPayment`.

## Alternative: point at a standalone hood402-facilitator

If isolating the Robinhood Chain gas key from the main API container is preferred, deploy
[`facilitator/`](./facilitator) as its own Cloud Run service instead (see
`facilitator/README.md`) and call its HTTP `/verify` + `/settle` endpoints from
`x402-robinhood.js` in place of the direct `verifyPayment`/`settlePayment` calls - same
`DIRECT_NETWORKS` wiring in `x402-spec.js`, just with an HTTP hop instead of an in-process
call. Use hood402's own `FacilitatorClient` for this:

```js
import { FacilitatorClient } from 'hood402';
const facilitator = new FacilitatorClient({ url: env.ROBINHOOD_FACILITATOR_URL });
// facilitator.verify(paymentPayload, requirements) / facilitator.settle(...).
```

This still bypasses the generic v2 `/supported`-probe path (`DIRECT_NETWORKS`) since the
facilitator's `/supported` reports `x402Version: 1`.

## Environment variables to add

| Variable | Where it's read | Purpose |
|---|---|---|
| `X402_PAY_TO_ROBINHOOD` | `x402-spec.js`, `payTo` on the accept entry | The address that receives USDG payments. |
| `ROBINHOOD_CHAIN_NETWORK` | `x402-robinhood.js` | `robinhood` (mainnet 4663) or `robinhood-testnet` (46630). |
| `ROBINHOOD_CHAIN_RPC_URL` | `x402-robinhood.js` | Optional RPC override (defaults to the public endpoint). |
| `ROBINHOOD_FACILITATOR_PRIVATE_KEY` | `x402-robinhood.js` (library mode only) | The gas wallet that broadcasts settlement. Never holds user funds. |
| `ROBINHOOD_FACILITATOR_URL` | `x402-robinhood.js` (standalone-facilitator mode only) | Base URL of a deployed `hood402-facilitator`. |

## Settlement wallet

Either mode needs one funded EVM key with a small amount of ETH on Robinhood Chain for
gas (USDG settlement itself is gasless for the *payer* - EIP-3009 - but the relayer/
facilitator still pays gas to broadcast). Store it the same way three.ws stores its other
chain keys: a Secret Manager-backed env var on the Cloud Run service, never in code or
`.env` files with real values (`.gitignore` already covers `.env*` - see the root
`CLAUDE.md` "Known traps" section for the existing env-var handling conventions on this
project).

## What this buys three.ws

Once wired, `network: robinhood-chain` becomes a normal entry in the existing
`paymentRequirements()` `accepts[]` array - any agent that already knows how to pay a
three.ws x402 endpoint (Base, BSC, Solana) sees a fourth option with no client-side changes
needed on their end for the ones that already speak generic v1 `exact`/EIP-3009 (most
x402 SDKs do, since it's the original scheme). Agents using hood402's own client, or any
other v1-speaking x402 client, can pay a three.ws endpoint in USDG directly.
~~~~

### `robinhood/hood402/README.md` (whole file)

~~~~markdown
# hood402

**The x402 payment rail for USDG on [Robinhood Chain](https://docs.robinhood.com/chain/) (chain ID 4663).**

Spec-conformant `exact`/EIP-3009 server middleware, a paying client, and a self-hostable
facilitator. Gasless USDG micropayments over plain HTTP 402 - no accounts, no API keys, no
subscriptions. hood402 follows the standard [x402 protocol](https://github.com/coinbase/x402)
wire format exactly, so it interoperates with the wider x402 client ecosystem, not just its
own client.

Docs: **https://nirholas.github.io/hood402/**

## Website

An interactive, single-file site lives in [`docs/`](./docs) and is served at
**https://nirholas.github.io/hood402/**. The core section is gated behind a live HTTP 402
turnstile: sign, pay, and watch the real `402 → X-PAYMENT → settle → 200` handshake open the
gate. Zero external requests; it works straight from `file://`.

Deploy your own copy (publishes the `docs/` folder as a static site):

[![Deploy to Cloudflare Pages](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/nirholas/hood402)
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/nirholas/hood402)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/nirholas/hood402)

## Why EIP-3009, and how we know

USDG (Paxos Global Dollar) is a facet/diamond-router stablecoin. Its base implementation
doesn't expose EIP-3009 directly, but `getFacet(bytes4)` proves the facet is registered - verified live against both networks:

```bash
npm run verify:usdg
```

```
robinhood (chain 4663) - USDG 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
  getFacet(transferWithAuthorization) -> 0x780d30b6a89BC9Eef953a543aA288c3B05b01309 [OK]
  getFacet(receiveWithAuthorization)  -> 0x780d30b6a89BC9Eef953a543aA288c3B05b01309 [OK]
  getFacet(authorizationState)        -> 0x780d30b6a89BC9Eef953a543aA288c3B05b01309 [OK]
  DOMAIN_SEPARATOR() -> 0x7a3d7400b27830f4f91c2c16a082486d67c1befecaec2f53b33f1f35d5b62036
  Expected domain: name="Global Dollar", version="1"

robinhood-testnet (chain 46630) - USDG 0x7E955252E15c84f5768B83c41a71F9eba181802F
  getFacet(transferWithAuthorization) -> 0x08f560a85db40a7d4ac49b4F44f1D38e5B8aB811 [OK]
  ...

PASS: USDG EIP-3009 facet registration confirmed on both networks.
```

The EIP-712 domain separator was reconstructed offline (`name="Global Dollar"`,
`version="1"`) and matches the live `DOMAIN_SEPARATOR()` on both chains exactly. This is
the load-bearing decision behind hood402: settlement is the standard, gasless
`transferWithAuthorization` path - the same mechanism USDC uses, and the one x402's `exact`
scheme is designed around. No custom scheme, no proxy contract, no Permit2 fallback needed.

See [Blockscout - mainnet USDG](https://robinhoodchain.blockscout.com/address/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168)
and [`docs/index.html`](./docs/index.html#conformance) for the full write-up.

## Install

```bash
npm install hood402 viem
```

Node ≥ 20. Until the package is on npm, install from a checkout: `npm i ../hood402`.

## Packages in this repo

| Path | What it is |
|---|---|
| `hood402` (this package) | Protocol types, the `exact`/EIP-3009 scheme, `verifyPayment`/`settlePayment`, and the `hood402/server` + `hood402/client` subpath exports |
| [`facilitator/`](./facilitator) | A standalone, self-hostable facilitator service - `/verify`, `/settle`, `/supported`, `/metrics`, an idempotent SQLite ledger, and a Dockerfile |

## Quickstart - server

```ts
import express from 'express'
import { paywall } from 'hood402/server'

const app = express()

app.get('/premium', paywall({
  price: '0.01',                              // USDG
  payTo: '0xYourReceivingAddress',
  network: 'robinhood',                        // or 'robinhood-testnet'
  facilitator: 'https://your-facilitator.example.com',
}), (req, res) => {
  res.json({ data: 'unlocked after a settled USDG payment' })
})
```

No facilitator? Pass `wallet` (a viem `WalletClient` holding a gas key), `account`, and
`reader` (a viem `PublicClient`) instead - the server verifies and settles locally:

```ts
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { robinhood } from 'viem/chains'
import { paywall } from 'hood402/server'

const account = privateKeyToAccount(process.env.FACILITATOR_PRIVATE_KEY as `0x${string}`)
const transport = http('https://rpc.mainnet.chain.robinhood.com')

app.get('/premium', paywall({
  price: '0.01',
  payTo: '0xYourReceivingAddress',
  network: 'robinhood',
  wallet: createWalletClient({ account, chain: robinhood, transport }),
  account: account.address,
  reader: createPublicClient({ chain: robinhood, transport }),
}), (req, res) => res.json({ data: 'unlocked' }))
```

Hono works too - use `honoPaywall` from `hood402/server` with the same options.

## Quickstart - client

```ts
import { Hood402Client, fromAccount } from 'hood402/client'
import { privateKeyToAccount } from 'viem/accounts'

const account = privateKeyToAccount(process.env.ROBINHOOD_CHAIN_PRIVATE_KEY as `0x${string}`)
const client = new Hood402Client({
  signer: fromAccount(account),
  maxSpendPerOrigin: '1.00',   // hard cap in USDG - refuses to sign above it
})

const res = await client.fetch('https://api.example.com/premium')
console.log(await res.json())  // the 402 was paid automatically
```

`client.fetchWithReceipt(url)` returns the response *and* the decoded
`X-PAYMENT-RESPONSE` settlement receipt (transaction hash, network, payer). In the
browser, build a `Signer` from an injected wallet with `fromWalletClient` instead of
`fromAccount`.

## Quickstart - facilitator

See [`facilitator/README.md`](./facilitator/README.md).

## Supported networks

| Network id | Chain ID | USDG address | Explorer |
|---|---|---|---|
| `robinhood` (mainnet) | 4663 | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | [Blockscout](https://robinhoodchain.blockscout.com) |
| `robinhood-testnet` | 46630 | `0x7E955252E15c84f5768B83c41a71F9eba181802F` | [Blockscout](https://explorer.testnet.chain.robinhood.com) |

Both are 6-decimal USDG with EIP-712 domain `name="Global Dollar", version="1"`. Aliases like
`"robinhood-chain"`, `"robinhood-mainnet"`, `"robinhood-sepolia"`, `eip155:4663`/`eip155:46630`,
and the bare chain ids `4663`/`46630` all resolve to the same two networks via
`resolveNetwork()`/`requireNetwork()`.

## API reference

### Root - `hood402`

Protocol primitives shared by both the server and client. Re-exported by `hood402/server` and
`hood402/client` where relevant.

| Export | What it does |
|---|---|
| `X402_VERSION`, `SCHEME` | Wire-protocol constants (`1`, `"exact"`). |
| `PaymentRequirements`, `PaymentRequiredResponse`, `ExactEvmAuthorization`, `ExactEvmPayload`, `PaymentPayload`, `VerifyResult`, `SettleResult`, `SettlementResponseHeader`, `SupportedResponse` | Wire-format TypeScript types. |
| `InvalidReason`, `REASON_TEXT` | The canonical failure-reason union and its human-readable text (e.g. `authorization_already_used` → *"The authorization nonce has already been settled (replay)."*). |
| `Hood402ConfigError`, `SpendCapExceededError` | Errors thrown on misconfiguration / an over-cap client payment. |
| `ROBINHOOD_MAINNET`, `ROBINHOOD_TESTNET`, `NETWORKS`, `HoodNetwork` | The network registry - chain id, RPC URL, explorer, USDG address/decimals/domain. |
| `resolveNetwork(idOrChainId)` | Resolve a network by id/alias/chain id; returns `undefined` if unknown. |
| `requireNetwork(idOrChainId)` | Same, but throws a descriptive error on an unknown network. |
| `PAYMENT_HEADER`, `PAYMENT_RESPONSE_HEADER` | The literal header names `"X-PAYMENT"` / `"X-PAYMENT-RESPONSE"`. |
| `Price` | `string \| { atomic: string } \| { usdg: string }` - how a resource's price can be expressed. |
| `toAtomic(price, decimals)` | Convert a `Price` to an atomic-unit decimal string. |
| `buildRequirements(input)` | Build a spec-compliant `PaymentRequirements` for a resource (price, `payTo`, network, description, …). |
| `buildPaymentRequired(accepts, error?)` | Wrap one or more `PaymentRequirements` into a 402 response body. |
| `TRANSFER_WITH_AUTHORIZATION_TYPES` | The EIP-712 `TransferWithAuthorization` type definition. |
| `usdgDomain(net)` | Build the EIP-712 domain for a network's USDG contract. |
| `randomNonce()` | Generate a fresh random 32-byte EIP-3009 nonce (browser + Node safe). |
| `authorizationMessage(auth)` | Convert an `ExactEvmAuthorization` (decimal-string fields) into its EIP-712 message form (bigint fields). |
| `verifyAuthorizationSignature(net, auth, signature)` | Verify an EIP-3009 signature recovers to `auth.from` (EOA + ERC-1271). |
| `isWellFormedPayload(p)` | Type-guard: does `p` have every required `PaymentPayload` field, correctly typed? |
| `validateStructural(payload, requirements, now?)` | The pure, RPC-free half of verification - scheme/network/asset/recipient/amount/expiry checks. |
| `verifyPayment(opts)` | Full verification state machine: structural → signature → (with a `reader`) replay → balance. Returns `VerifyResult`. |
| `settlePayment(opts)` | Re-verify, then broadcast `transferWithAuthorization` and await the receipt. Returns `SettleResult`. |
| `encodeBase64Json`, `decodeBase64Json`, `encodePaymentHeader`, `decodePaymentHeader`, `encodeSettlementHeader`, `decodeSettlementHeader` | Base64/JSON codecs for the `X-PAYMENT` and `X-PAYMENT-RESPONSE` header values. |
| `FacilitatorClient` | HTTP client for a remote facilitator - `supported()`, `verify(payload, requirements)`, `settle(payload, requirements)`. |
| `eip3009Abi`, `erc20Abi` | The minimal viem ABI fragments used for `transferWithAuthorization`, `authorizationState`, `balanceOf`, `decimals`. |

### `hood402/server`

| Export | What it does |
|---|---|
| `paywall(opts: PaywallOptions)` | Express middleware. Verifies `X-PAYMENT`, settles, sets `X-PAYMENT-RESPONSE`, then calls `next()`. |
| `honoPaywall(opts: PaywallOptions)` | Same semantics as `paywall`, for a Hono `Context`. |
| `PaywallEngine` | The framework-agnostic engine both adapters wrap - `requirements(resource)`, `authorize(headerValue, resource)`, `settle(payload, requirements)`, `settlementHeader(result)`. Use it directly to build an adapter for another framework. |
| `PaywallOptions` | `{ price, payTo, network?, description?, mimeType?, maxTimeoutSeconds?, resource?, facilitator? }` (facilitator mode) or the same plus `{ wallet, account, reader }` (self-settle mode) - one of the two settlement modes is required. |
| `getAddress` | Re-exported from viem for convenience. |

### `hood402/client`

| Export | What it does |
|---|---|
| `Hood402Client` | The paying client. `fetch(url, init?)`, `fetchWithReceipt(url, init?)`, `sign(requirements)`, `spent(origin)`. |
| `Hood402ClientOptions` | `{ signer, maxSpendPerOrigin?, allowedNetworks?, fetch?, validitySeconds?, now? }`. |
| `fromAccount(account)` | Build a `Signer` from a viem `LocalAccount` (private key). |
| `fromWalletClient(client, address)` | Build a `Signer` from a viem `WalletClient` (e.g. an injected browser wallet). |
| `wrapFetch(opts)` | Convenience: returns a plain `fetch`-compatible function that transparently pays every 402 it hits. |
| `Signer` | The minimal typed-data-signing interface `Hood402Client` needs - `{ address, signTypedData }`. |
| `PaidResponse` | `{ response, paid, settlement? }` - the return type of `fetchWithReceipt`. |
| `AuthorizationMessage` | The EIP-712 message shape (`ExactEvmAuthorization` with bigint numeric fields) passed to `signTypedData`. |

## Environment variables

hood402 itself is a library and reads no env vars - these are the ones the **examples**,
**facilitator**, and **`scripts/verify-usdg.mjs`** in this repo use (see
[`.env.example`](./.env.example)). Wire them into your own app's config however you like.

| Variable | Used by | Meaning |
|---|---|---|
| `FACILITATOR_PRIVATE_KEY` | `facilitator/` | The gas wallet that broadcasts settlement transactions. Needs ETH on every network it settles. Never holds user funds - only relays signed EIP-3009 authorizations. |
| `FACILITATOR_NETWORKS` | `facilitator/` | Comma-separated networks to settle on (default `robinhood,robinhood-testnet`). |
| `ROBINHOOD_RPC_URL` | `facilitator/` | Optional mainnet RPC override (defaults to the public Robinhood Chain RPC). |
| `ROBINHOOD_TESTNET_RPC_URL` | `facilitator/` | Optional testnet RPC override. |
| `PORT` | `facilitator/` | HTTP port for the facilitator service (default `4021`). |
| `LEDGER_PATH` | `facilitator/` | Path to the SQLite settlement ledger (default `./data/hood402-ledger.sqlite`). |
| `ROBINHOOD_CHAIN_PRIVATE_KEY` | client examples | The wallet that signs USDG payments. Needs USDG balance, not ETH - the payer never pays gas. |
| `HOOD402_MAX_SPEND_PER_ORIGIN` | client examples | Hard per-origin spend cap in USDG (maps to `Hood402ClientOptions.maxSpendPerOrigin`). |
| `DEMO_PORT`, `DEMO_PAY_TO`, `FACILITATOR_URL` | `examples/demo-server.ts` | Demo resource-server port, payee address, and facilitator URL. |

See [`facilitator/README.md`](./facilitator/README.md#environment-variables) for the
facilitator's own copy of this table with defaults spelled out per-field.

## Security model

- **The facilitator never holds user funds.** It relays signed EIP-3009 authorizations -   the payer's signature fixes the amount and recipient; the facilitator can only choose
  *whether* to broadcast, not *what*.
- **Replay protection is two-layered.** Every authorization carries a random 32-byte nonce
  checked against on-chain `authorizationState` before verification passes, and the
  facilitator's SQLite ledger claims an idempotency slot on `(network, payer, nonce)`
  before broadcasting - a retried `/settle` for the same signed payment returns the
  original transaction instead of double-spending gas.
- **Validity windows are short by default** (`client.fetch`'s signer sets a 300-second
  window) - a leaked signature has a narrow blast radius.
- **The client enforces a hard spend cap per origin** (`maxSpendPerOrigin`) - it refuses to
  sign a payment that would exceed the cap, before any network call.
- **Keys are env vars only.** `FACILITATOR_PRIVATE_KEY` (the gas wallet) and
  `ROBINHOOD_CHAIN_PRIVATE_KEY` (a payer) are never hardcoded or logged. See
  [`.env.example`](./.env.example).

## Development

```bash
npm install
npm run build
npm test              # vitest - the exact/EIP-3009 state machine, 65 tests
npm run verify:usdg   # live on-chain proof of the EIP-3009 facet + domain separator
npm run e2e           # full interop proof - see examples/e2e.ts

cd facilitator && npm install && npm test   # 18 more tests: ledger idempotency + HTTP endpoints
```

`npm run e2e` proves the whole flow against live chain state: real mainnet reads, a real
HTTP 402 → sign → pay round trip over an actual socket, a real testnet RPC verify call, and
a real `eth_call` simulation of the settlement transaction. It states plainly which parts
are live broadcast vs. simulation - see the script's own header comment for the full
rationale.

## License

All rights reserved. See [LICENSE](./LICENSE).

Built by [nirholas](https://x.com/nichxbt) · [three.ws](https://three.ws)
~~~~

