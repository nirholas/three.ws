# Playwright covers the agent on-chain deploy and token-launch buttons with an injected wallet, devnet only

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/777-plan-onchain-deploy-wallet-flow-e2e.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 25 of 100 inside the tier). **Area:** onchain. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

`src/onchain/` holds the deploy and token-launch stack (`OnchainDeployButton`, `LaunchTokenButton`, chain adapters, `deploy.js`). Its README admits the wallet I/O is "integration-tested via Playwright (not yet written for this module)". Pure logic is covered by `tests/src/onchain.test.js`, `onchain-payments.test.js` and `onchain-tokens.test.js`, but nothing exercises the click-to-signed-transaction path in a real browser, so regressions in the button state machine, prep/confirm round trips and error states ship unseen.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `src/onchain/deploy-button.js` exports `OnchainDeployButton`, `normalizeOnchain`; `launch-token-button.js` exports `LaunchTokenButton`; `deploy.js` exports `deployAgent`; adapters sit in `src/onchain/adapters/`.
- Server side: `api/agents/onchain/prep.js` and `confirm.js`, plus `/api/agents/tokens/launch-prep` and `launch-confirm`.
- Consumers: `src/agent-detail.js`, `src/dashboard-next/pages/agents.js`, `src/pump/launch-token-modal.js`, `src/erc8004/solana-deploy.js`.
- `tests/e2e/` has no spec that names these buttons (grep for `deploy-button`, `launch-token-button`, `onchain` finds none). The README todo is at `src/onchain/README.md` lines ~158-159.
- Existing e2e conventions: `tests/e2e/_support.js` and `tests/e2e/README.md`; `home-connect-stubs.js` shows how this repo injects a wallet into a page.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
grep -rln "OnchainDeployButton\|LaunchTokenButton\|onchain/deploy" tests/e2e tests | head
sed -n 150,165p src/onchain/README.md
sed -n 1,80p tests/e2e/_support.js
sed -n 1,60p tests/e2e/home-connect-stubs.js
grep -n "solana\|wallet" tests/e2e/README.md | head
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Read `tests/e2e/README.md` and `_support.js`. Decide which page mounts `OnchainDeployButton` with the least setup (agent detail or the dashboard agents page) and how a test signs in (QA login from the `self-unblock-playbook` skill).
2. Write `tests/e2e/onchain-deploy-wallet.spec.js`. Inject a Solana wallet standard provider into the page (an in-page signer built from a throwaway devnet keypair generated in the test, following the pattern in `home-connect-stubs.js`). Cover: button idle state, click with no wallet (actionable error state), wallet present and prep call succeeding (button moves through pending to confirm), user rejection (clean cancelled state, button re-enabled), prep failure (server 4xx surfaced with a recovery hint), and double-click safety (one prep call only). Assert network calls hit the real `/api/agents/onchain/prep` and `confirm` routes; where a call would spend or land a transaction, run against devnet (never mainnet) or stop at the signed-transaction boundary and assert on the request payload.
3. Write `tests/e2e/onchain-token-launch.spec.js` for `LaunchTokenButton` the same way, stopping before any real launch: assert the confirmation table (recipient, amount, chain) renders and that cancelling sends nothing. Do not launch or mint anything.
4. Fix any real defects the specs expose, test-first (the spec is the failing test), in `src/onchain/`.
5. Replace the todo in `src/onchain/README.md` with a "Tests" paragraph naming the new specs; add a `tests/e2e/README.md` row.
6. Run the specs in a real browser (`npx playwright test tests/e2e/onchain-deploy-wallet.spec.js tests/e2e/onchain-token-launch.spec.js`) three times to confirm they are not flaky; check there are no console errors during the runs.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx playwright test tests/e2e/onchain-deploy-wallet.spec.js tests/e2e/onchain-token-launch.spec.js` passes three runs in a row.
- [ ] `grep -n 'todo' src/onchain/README.md` returns nothing for the Playwright note.
- [ ] No test signs or sends a mainnet transaction; the specs generate their own throwaway keypairs and contain no private key literal.
- [ ] `npx vitest run tests/src/onchain.test.js tests/src/onchain-tokens.test.js tests/src/onchain-payments.test.js` still passes.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Devnet airdrop rate-limited | Stop at the signed-transaction boundary and assert the request payload; do not depend on landing a transaction. |
| QA sign-in fails | Follow the QA login row in the `self-unblock-playbook` skill. |
| Playwright browsers missing | `npx playwright install chromium` as `tests/e2e/README.md` states. |
| Swiftshader slows the page | The buttons mount on 2D pages; use the light page the memory note "Verify /play features without the 3D world" describes if a 3D world is in the way. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/777-plan-onchain-deploy-wallet-flow-e2e.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `777-plan-onchain-deploy-wallet-flow-e2e.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `src/onchain/README.md` (whole file)

~~~~markdown
# src/onchain

Unified, family-agnostic on-chain deploy stack. This superseded the legacy
`src/erc8004/deploy-button.js` (deleted 2026-08-06); `src/erc8004/solana-deploy.js`
remains as the RegisterUI wizard's Solana driver (vanity grinding included).

## Why this exists

The legacy stack branches on chain family (`if isSolana ...`) at every layer:
deploy button, register-prep payload, agent_identities `meta` shape. Every new
chain family doubles the branching surface. This module collapses all of that
behind two abstractions:

- **`ChainRef`** - a CAIP-2-shaped value: `{ family, chainId | cluster }`. Every
  helper takes a `ChainRef`. Family-specific knowledge does not leak into the
  UI.
- **`WalletAdapter`** - `{ connect, switchTo, signAndSend }`. EVM and Solana
  adapters implement the same interface; the deploy orchestrator never sees
  `window.ethereum` or `window.phantom` directly.

## Layout

```
src/onchain/
├── chain-ref.js          ChainRef + CAIP-2 + chain registry (pure)
├── adapters/
│   ├── base.js           WalletAdapter abstract class + isUserRejection()
│   ├── evm.js            ethers + window.ethereum
│   ├── solana.js         @solana/web3.js + Phantom/Backpack/Solflare + inline SIWS
│   └── index.js          getAdapter(family) factory with cache
├── deploy.js             Unified prep → sign → confirm orchestrator
└── deploy-button.js      Mountable UI component (drop-in for legacy)
```

## API surface (frontend)

```js
import { OnchainDeployButton } from 'src/onchain/deploy-button.js';

const btn = new OnchainDeployButton({
  agent,                          // { id, name, description?, avatarId?, onchain? }
  container: document.querySelector('#deploy'),
  preferredChain: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',  // CAIP-2; default Solana mainnet (Metaplex Core)
});
btn.mount();
```

Or, headless:

```js
import { deployAgent } from 'src/onchain/deploy.js';
import { evm, solana } from 'src/onchain/chain-ref.js';

const result = await deployAgent({
  agent,
  ref: solana('devnet'),
  onProgress: (step) => console.log(step), // 'connect'|'prep'|'sign'|'confirm'|'save'
});
// → { ref, txHash, onchainId, contractOrMint, agent }
```

### Solana transaction v1

Solana deploys negotiate the transaction format after wallet connection. When
the matching Wallet Standard account advertises transaction version `1`, prep
returns a v1 Metaplex Core mint with explicit `transactionConfig` caps and the
wallet signs its raw bytes through `solana:signTransaction`. Wallets without v1
support continue through the existing v0 path automatically.

The v1 deploy config is intentionally explicit because v1 compute-unit and
loaded-account-data limits otherwise resolve to zero. Server-side asset and
collection signatures are applied before the prepared transaction is returned;
the connected owner wallet supplies the remaining fee-payer signature.

## API surface (server)

Two endpoints - replace the four legacy ones:

| Endpoint                          | Purpose                                                 |
| --------------------------------- | ------------------------------------------------------- |
| `POST /api/agents/onchain/prep`   | Pin manifest, build family-specific tx prep, return prepId |
| `POST /api/agents/onchain/confirm`| Verify tx on-chain, link wallet, write `meta.onchain`   |

Request shape (prep):

```json
{
  "agent_id": "uuid",
  "chain": "eip155:8453",
  "wallet_address": "0x...",
  "name": "...",
  "description": "...",
  "avatar_id": "uuid|null",
  "skills": ["..."]
}
```

Response (prep): `{ prepId, chain, metadataUri, cid, contractAddress | { assetPubkey, txBase64, cluster, transactionVersion } }`

Request shape (confirm):

```json
{
  "prep_id": "...",
  "tx_hash": "0x... | <base58 sig>",
  "onchain_id": "<EVM agentId> | null",
  "wallet_address": "..."
}
```

Confirm writes a single canonical block to `agent_identities.meta.onchain`:

```json
{
  "onchain": {
    "chain":            "eip155:8453",
    "family":           "evm",
    "tx_hash":          "0x...",
    "onchain_id":       "42",
    "contract_or_mint": "0x8004...",
    "wallet":           "0x...",
    "metadata_uri":     "ipfs://...",
	"transaction_version": 1,
    "confirmed_at":     "2026-..."
  }
}
```

Frontend reads `agent.onchain` only - no family-specific fields.

## Migration

`api/_lib/migrations/2026-04-29-onchain-unified.sql` backfills legacy rows
(both EVM and Solana shapes) into `meta.onchain`. Idempotent. Apply via:

```bash
psql $DATABASE_URL -f api/_lib/migrations/2026-04-29-onchain-unified.sql
```

The legacy endpoints (`register-prep`, `register-confirm`,
`solana-register-prep`, `solana-register-confirm`) are left intact. Deprecate
once all callers move to `/api/agents/onchain/*`.

## Adding a new chain family

1. Add a `ChainRef` constructor + CAIP-2 namespace handling in `chain-ref.js`.
2. Add an entry helper to `buildRegistry()` so it appears in the dropdown.
3. Implement `WalletAdapter` for the family in `adapters/<name>.js`.
4. Wire the adapter into `getAdapter()` in `adapters/index.js`.
5. Add a `prep<Family>()` branch in `api/agents/onchain/prep.js` and a
   `verify<Family>()` branch in `api/agents/onchain/confirm.js`.

No UI changes required.

## Tests

`tests/src/onchain.test.js` - pure-logic coverage of `chain-ref` + adapter
factory dispatch. Wallet I/O is integration-tested via Playwright (not yet
written for this module - todo).

## Token launches (Pump.fun, …)

Layered on top of the deploy stack. Same pattern: a `TokenAdapter` interface
under `src/onchain/tokens/` with one impl today (`PumpfunTokenAdapter`) and
two endpoints (`/api/agents/tokens/launch-prep` + `launch-confirm`) writing a
canonical `meta.token` block on the agent record:

```json
{
  "token": {
    "provider":     "pumpfun",
    "mint":         "<base58>",
    "symbol":       "AGT",
    "name":         "Agent",
    "metadata_uri": "ipfs://...",
    "cluster":      "mainnet" | "devnet",
    "creator":      "<base58>",
    "tx_signature": "<base58>",
    "launched_at":  "2026-...",
    "pumpfun_url":  "https://pump.fun/<mint>"
  }
}
```

Mounting:

```js
import { LaunchTokenButton } from 'src/onchain/launch-token-button.js';
new LaunchTokenButton({ agent, container }).mount();
```

The button auto-hides itself unless the agent is deployed on Solana. After a
launch, it rehydrates as a chip linking to the Pump.fun page (mainnet) or
Solana Explorer (devnet).

Schema migration: `api/_lib/migrations/2026-04-29-token-launches.sql`.

Pump.fun specifics:
- The mint Keypair is generated server-side and partial-signs the launch tx.
  Its secret key never touches the client and is dropped after partial-signing.
- Optional `initial_buy_sol` (0-50) buys the first slot on the bonding curve
  in the same transaction as the create.
- Compute budget is bumped to 350k units - coin creation routinely overflows
  the 200k default and reverts otherwise.
- Mainnet only after deploy. Devnet works for QA via Pump.fun's devnet-tagged
  SDK builds (`@pump-fun/pump-sdk@*-devnet.*`).

### Cost preview

`GET /api/agents/tokens/launch-quote?initial_buy_sol=0.5&cluster=mainnet` →
`{ fixed_total_sol, initial_buy: { tokens_out, protocol_fee_sol }, total_sol }`.
Returns conservative upper-bound rent costs + a live curve quote when an
initial buy is requested. Surface in any UI that asks the user to launch.

### Migrations

Apply migrations with the bundled runner:

```bash
DATABASE_URL=postgres://… node scripts/apply-migrations.mjs           # dry-run
DATABASE_URL=postgres://… node scripts/apply-migrations.mjs --apply   # execute
```

Tracks state in `schema_migrations` (filename + sha256). Refuses to proceed
if a previously-applied file has been edited after the fact (drift) - roll
forward with a new migration instead.

## Agent payments (Pump.fun agent-payments-sdk)

Layered on top of token launches. Same prep/sign/submit/confirm pattern.

Two flows:

- **Owner enables payments** - once the agent has a launched token, the owner
  signs a one-time `create` tx that registers the agent's TokenAgentPayments
  PDA. Persists `meta.payments` on the agent record.
- **Anyone pays the agent** - signed-in user picks a currency mint + amount,
  signs an `agent_accept_payment` tx, server verifies via the SDK's
  `validateInvoicePayment` and writes `agent_payment_intents.status='paid'`.

```js
import {
  EnablePaymentsButton,
  PayAgentButton,
} from 'src/onchain/payments-buttons.js';

new EnablePaymentsButton({ agent, container }).mount(); // owner-only
new PayAgentButton({ agent, container }).mount();       // any signed-in user
```

Endpoints: `/api/agents/payments/{create-prep,create-confirm,pay-prep,pay-confirm}`.
Schema: `payment_configs_pending` + `agent_payment_intents` (see migration
`2026-04-29-agent-payments.sql`).

`meta.payments` shape (returned at top level on `/api/agents/:id` as
`agent.payments` when configured):

```json
{
  "payments": {
    "configured":      true,
    "provider":        "pumpfun",
    "mint":            "<token mint base58>",
    "token_agent_pda": "<TokenAgentPayments PDA base58>",
    "receiver":        "<owner wallet base58>",
    "cluster":         "mainnet" | "devnet",
    "tx_signature":    "<base58>",
    "configured_at":   "2026-...",
    "accepted_tokens": []
  }
}
```

## Vanity wallets (custodial agent identities)

Agents can be provisioned with a custodial Solana wallet whose address starts
with a chosen base58 prefix. The secret key is encrypted server-side
(AES-GCM, HKDF-derived from `JWT_SECRET`) and never leaves the server after
provisioning.

```js
import { VanityWalletButton } from 'src/onchain/vanity-wallet-button.js';
new VanityWalletButton({ agent, container }).mount();
```

Headless usage:

```js
import { provisionVanityForAgent } from 'src/onchain/vanity/index.js';
await provisionVanityForAgent({
  agentId,
  prefix: 'AGNT',
  ignoreCase: false,
  onProgress: ({ rate, eta }) => console.log(rate, eta),
});
```

Grinding happens client-side via Web Workers (one per logical core, capped
at 8). Long prefixes take time - pass an `AbortSignal` to support a Cancel
UX. Server-side grinding for 5+ char prefixes already exists in
`api/_lib/pump-vanity.js` and is wired into the legacy `pumpfun/launch`
flow.

The provisioning endpoint (`POST /api/agents/:id/solana`) verifies that the
submitted secret derives the claimed pubkey and that the prefix matches
before storing the encrypted secret.

## x402 (HTTP 402 Payment Required for paid skills)

Wires the agent payments layer to per-call paywalls. Any agent endpoint can
return `402 Payment Required` with a canonical manifest; clients pay via the
Pump.fun agent-payments flow and retry with `x-payment-intent`.

Server middleware:

```js
import { emit402, verifyPaid, consumeIntent } from 'api/_lib/x402.js';

const paid = await verifyPaid(req, {
  agentId, skill: 'summarize',
  expectedAmount: '10000',
  expectedCurrency: USDC_MINT,
});
if (!paid) return emit402(res, { agent, skill, amount, currency });
await consumeIntent(paid.intentId);  // single-shot
return doTheThing();
```

Reference impl: `api/agents/x402/invoke.js` (paid-skill router with `echo`
demo skill). Manifest discovery at `GET /api/agents/x402/manifest`.

Client wrapper that follows 402 automatically:

```js
import { x402Fetch } from 'src/onchain/x402/client.js';
const res = await x402Fetch('/api/agents/x402/invoke', {
  method: 'POST',
  body: JSON.stringify({ agent_id, skill: 'echo', args: {} }),
  onPaymentRequired: () => 'auto',
});
```

Full spec at [docs/x402.md](../../docs/x402.md).

Note: the agent-payments-sdk is published as a restricted npm package. If
`npm install` fails with 403, contact Pump.fun for access. The pump-sdk used
for token launches is public and unaffected.

Adding another launchpad:
1. Implement `TokenAdapter` in `src/onchain/tokens/<provider>.js`.
2. Add to `getTokenAdapter()` in `src/onchain/tokens/index.js`.
3. Branch on `provider` in `api/agents/tokens/launch-prep.js`.
4. UI auto-extends if you make the dropdown provider-aware (single provider
   today, no dropdown).
~~~~

