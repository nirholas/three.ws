# EVM AgentPayments gets a CREATE2 deploy tool, fork proof, address wiring and the pending Basescan verification

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/984-plan-evm-agentpayments-create2-deploy-readiness.md`.

**Priority:** Gated, the last step needs an owner action or outside party (score 22 of 100 inside the tier). **Area:** contracts. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The EVM port of the Solana agent-payments engine (`contracts/src/AgentPayments.sol`, 16 passing tests) is not deployed on any chain, so `EvmAgent` in `agent-payments-sdk` throws "AgentPayments contract is not deployed on chain N" at construction (every `agentPayments` address in `agent-payments-sdk/src/evm/addresses.ts` is the zero address). Separately, the live `ThreeWSPayments` receiver on Base is bytecode-confirmed but its Basescan source verification is still PENDING. This is an additional EVM surface (Solana stays the home chain and is covered elsewhere); the agent can finish everything except the funded broadcasts.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `contracts/script/DeployAgentPayments.s.sol` does a plain `new AgentPayments(owner)` (per-chain addresses by nonce). `contracts/AGENT_PAYMENTS.md` says a CREATE2 deploy through `ThreeWSFactory` (`0x00000000d49195ae81759cd247cfedd9d0b479df`) with a shared salt would give one address on every chain, but no script does it.
- `contracts/DEPLOYMENTS.md` AgentPayments table is six rows of `todo: fill after deployment` (Ethereum, Base, Arbitrum, Polygon, BSC, Avalanche).
- `scripts/verify-threews-payments-base.mjs` exists and prints a Standard JSON Input bundle without a `BASESCAN_API_KEY`; the DEPLOYMENTS note says verification is pending.
- The BNB testnet WorldMoves/GreenfieldVault deploys are retired by the owner; do not touch them.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
grep -n "agentPayments:" agent-payments-sdk/src/evm/addresses.ts
grep -n "todo: fill after deployment" contracts/DEPLOYMENTS.md | head
ls contracts/script scripts | grep -i "agent-payments\|verify-threews"
cd contracts && forge test --match-contract AgentPaymentsTest 2>&1 | tail -5
for c in 8453 56 42161; do :; done   # factory liveness: eth_getCode of 0x00000000d49195ae81759cd247cfedd9d0b479df on each chain via public RPCs in api/_lib/erc8004-chains.js
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Write `contracts/script/DeployAgentPaymentsCreate2.s.sol` that deploys `AgentPayments(owner)` through `ThreeWSFactory` with a fixed salt (document the salt), computes and asserts the predicted address before broadcasting, and reverts if code already exists at it. Add a Foundry test in `contracts/test/` proving the same init code and salt give the same address under two different chain ids (use `vm.chainId`).
2. Write `scripts/deploy-agent-payments-evm.mjs` that, per chain in `{1, 8453, 42161, 137, 56, 43114}`, reads the RPC from `api/_lib/erc8004-chains.js`, checks the factory exists, computes the predicted address, estimates gas and cost in native token, and prints a confirmation table (chain, factory, predicted address, owner, estimated cost). It signs and broadcasts nothing without `--yes` plus `--confirm-mainnet`. Unit-test the planning code in `tests/` with recorded RPC responses from a local `anvil` fork.
3. Prove the deploy on `anvil --fork-url` for Base and BSC (fork, not live), including `setRouterAllowed` for the chain's canonical router, then `acceptPayment`, `distributePayments` and `withdraw` through the SDK's `EvmAgent` against the fork. Record the transcript summary (not private keys) in `contracts/DEPLOYMENTS.md`.
4. Add `scripts/wire-agent-payments-addresses.mjs` that takes the deployed address(es) and updates `agent-payments-sdk/src/evm/addresses.ts` and the `DEPLOYMENTS.md` table in one pass, plus a test that the SDK constructor stops throwing for a chain once its address is non-zero. Run `npm run build` in `agent-payments-sdk/` and its tests.
5. Basescan verification: run `scripts/verify-threews-payments-base.mjs`; if `BASESCAN_API_KEY` exists in the Cloud Run env or Secret Manager (read names only, then read the value with `node scripts/read-service-env.mjs`), publish it and update the DEPLOYMENTS note from PENDING to verified with the explorer link. If the key exists nowhere, leave the script ready and say so in the report.
6. Update `contracts/AGENT_PAYMENTS.md` (replace the "no CREATE2 here" paragraph with the real command) and `contracts/README.md` status rows.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `cd contracts && forge test` passes including the new cross-chain-id address parity test.
- [ ] `node scripts/deploy-agent-payments-evm.mjs` (no flags) prints the six-chain confirmation table and exits 0 without signing.
- [ ] The anvil fork transcript shows deploy, router allow-list, payment, distribute and withdraw succeeding for Base and BSC forks.
- [ ] `cd agent-payments-sdk && npm run build && npm test` passes.
- [ ] `grep -c "todo: fill after deployment" contracts/DEPLOYMENTS.md` is 0 or each remaining row is explicitly marked "pending owner broadcast" with its predicted address.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No funded deployer on any chain | Everything runs on anvil forks; the live broadcast is the only gated step. |
| A chain's public RPC is flaky | Use the fallback lanes in `api/_lib/erc8004-chains.js`; fork from whichever lane answers. |
| No Basescan key | Leave the verification script ready; do not stall the rest. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Live mainnet deploys on six chains spend real gas and the router allow-list is an on-chain write: print the confirmation table (chain, address, owner, estimated cost) and stop for the owner's explicit yes, batched into one message at the end.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/984-plan-evm-agentpayments-create2-deploy-readiness.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `984-plan-evm-agentpayments-create2-deploy-readiness.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `contracts/AGENT_PAYMENTS.md` (whole file)

~~~~markdown
# AgentPayments - EVM deployment guide

`AgentPayments` ([`src/AgentPayments.sol`](src/AgentPayments.sol)) is the EVM port
of the Solana `pump_agent_payments` program
(`AgenTMiC2hvxGebTsgmsD4HHBa8WEcqGFf87iwRRxLo7`). It is the on-chain engine behind
three.ws **agent tokens** on EVM chains: users pay an agent in any ERC-20 (or
native) currency, the agent's authority withdraws its share, and a configurable
slice is swapped into the agent's own token and burned (buyback).

It exists because the SDK already ships the client side - `EvmAgent` /
`EvmAgentOffline`, the `AGENT_PAYMENTS_ABI`, and the per-chain address table in
[`agent-payments-sdk/src/evm/addresses.ts`](../agent-payments-sdk/src/evm/addresses.ts) - but every `agentPayments` address there is the zero-address placeholder, so the
SDK throws `"AgentPayments contract is not deployed on chain N"` at construction.
Deploying this contract and filling in those addresses turns the EVM path on.

> **Solana note.** The Solana side needs **no** deployment - the SDK's Solana path
> (`PumpAgent` / `PumpAgentOffline`) binds to pump.fun's already-live mainnet
> program `AgenTMiC2…`. A Solidity contract cannot run on Solana (different VM);
> this contract is the EVM equivalent, not a Solana artifact.

## What it implements

The contract's ABI is byte-for-byte the SDK's `AGENT_PAYMENTS_ABI`. State is keyed
by `(agentToken, currencyToken)`, mirroring the Solana program's per-mint /
per-currency PDAs. Native currency (ETH/BNB/AVAX) is accounted under the EIP-7528
sentinel `0xEee…EeE`.

| Function | Access | Effect |
| --- | --- | --- |
| `createAgent(agentToken, agentAuthority, buybackBps)` | owner only | Register an agent token once |
| `acceptPayment(agentToken, currency, amount, memo, startTime, endTime)` | anyone | Pull ERC-20, credit payment vault, settle invoice |
| `acceptPaymentNative(agentToken, memo, startTime, endTime)` | anyone (payable) | Same, native currency |
| `distributePayments(agentToken, currency)` | anyone | Split payment vault → buyback + withdraw vaults by `buybackBps` |
| `buybackTrigger(agentToken, currency, swapRouter, swapData)` | owner | Swap buyback vault → agent token via allow-listed router, burn it |
| `withdraw(agentToken, currency, receiver)` | agent authority | Send withdraw vault to `receiver` |
| `updateBuybackBps` / `updateAuthority` | agent authority | Reconfigure |
| `setRouterAllowed(router, allowed)` | owner | Manage the buyback router allow-list |
| `getAgentConfig` / `getBalances` / `getPaymentStats` / `isInvoicePaid` | view | Reads used by `EvmAgent` |

Invoice IDs match the SDK's `getInvoiceId()` exactly:
`keccak256(abi.encode(agentToken, currencyToken, amount, memo, startTime, endTime))`.

## Security model

- **Owner = protocol / global buyback authority.** It registers agents on a
  user's behalf, triggers buybacks, and manages the router allow-list. Use the
  **platform multisig**, not a hot EOA, in production.
- **Per-agent authority** controls only its own agent: withdrawals and config.
- **Buyback cannot abuse payer allowances.** Payers grant this contract a
  `maxUint256` ERC-20 allowance (the SDK approves max). `buybackTrigger` therefore
  (a) only calls **allow-listed** routers, (b) forbids the currency/agent token as
  the "router", and (c) approves the router for exactly the buyback amount and
  resets to zero afterward. There is no path for the owner to redirect the
  contract's calls at a token to drain those allowances.
- **Reentrancy.** `acceptPayment*`, `buybackTrigger`, and `withdraw` are
  `nonReentrant`; vault effects are applied before external calls.
- **Fee-on-transfer safe.** ERC-20 payments credit the balance actually received,
  not the requested amount.

Test coverage: [`test/AgentPayments.t.sol`](test/AgentPayments.t.sol) - 16 tests,
all passing (`forge test --match-contract AgentPaymentsTest`).

## Deploy

You fund a deployer EOA with gas on each target chain; everything else is below.

### 1. Install Foundry & configure

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
cd contracts
cp .env.example .env
# Fill in DEPLOYER_PK, BASESCAN_API_KEY (or per-chain scan keys),
# and AGENT_PAYMENTS_OWNER (the platform multisig; defaults to deployer EOA).
forge test --match-contract AgentPaymentsTest   # sanity check
```

### 2. Deploy (testnet first)

```bash
source .env
forge script script/DeployAgentPayments.s.sol:DeployAgentPayments \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --private-key $DEPLOYER_PK \
  --broadcast --verify
```

### 3. Deploy to each mainnet chain

Run once per chain the SDK supports, swapping `--rpc-url`. The deployed address
differs per chain (no CREATE2 here - addresses depend on deployer nonce):

| Chain | Chain ID | RPC env |
| --- | --- | --- |
| Ethereum | 1 | `$ETH_RPC_URL` |
| Base | 8453 | `$BASE_RPC_URL` |
| Arbitrum One | 42161 | `$ARB_RPC_URL` |
| Polygon | 137 | `$POLYGON_RPC_URL` |
| BNB Smart Chain | 56 | `$BSC_RPC_URL` |
| Avalanche | 43114 | `$AVAX_RPC_URL` |

```bash
forge script script/DeployAgentPayments.s.sol:DeployAgentPayments \
  --rpc-url $BASE_RPC_URL --private-key $DEPLOYER_PK --broadcast --verify
```

> Want one identical address across all chains (like `ThreeWSPayments`)? Deploy
> through the existing `ThreeWSFactory` CREATE2 deployer at
> `0x00000000d49195ae81759cd247cfedd9d0b479df` with a shared salt. Because the
> constructor takes only `owner` (no chain-specific immutable), the same salt +
> init code yields the **same** address on every chain - unlike `ThreeWSPayments`,
> whose per-chain USDC immutable broke address parity. See
> [`DEPLOYMENTS.md`](DEPLOYMENTS.md) for the factory ABI and salt workflow.

### 4. Allow-list buyback routers (per chain)

Buybacks only call allow-listed routers. Add the chain's canonical DEX
aggregator/router before the first buyback:

```bash
cast send <AGENT_PAYMENTS_ADDR> "setRouterAllowed(address,bool)" <ROUTER> true \
  --rpc-url $BASE_RPC_URL --private-key $DEPLOYER_PK
```

(e.g. the 0x Exchange Proxy or Uniswap Universal Router on each chain. The
`swapData` passed to `buybackTrigger` is the router's own swap calldata, built
off-chain to swap the held currency into the agent token and deliver it here.)

### 5. Wire the addresses into the SDK

Replace the `UNDEPLOYED` placeholders in
[`agent-payments-sdk/src/evm/addresses.ts`](../agent-payments-sdk/src/evm/addresses.ts)
with the deployed address for each chain:

```ts
8453: {
  ...
  agentPayments: "0xYourDeployedBaseAddress",   // was UNDEPLOYED
},
```

Then rebuild the SDK so `dist/` picks up the change:

```bash
cd agent-payments-sdk && npm run build
```

`isAgentPaymentsDeployed(chainId)` flips to `true` for each filled chain and
`new EvmAgent(token, chainId)` stops throwing - the EVM agent-payments path is now
live on that chain.

### 6. Record the deployment

Add a row per chain to the **AgentPayments** table in
[`DEPLOYMENTS.md`](DEPLOYMENTS.md) (address, tx hash, owner, routers allow-listed),
and append a `data/changelog.json` entry (tags: `infra`, `sdk`) noting EVM agent
payments are live.
~~~~

### `contracts/DEPLOYMENTS.md` (section "AgentPayments (EVM agent-token payment engine)")

~~~~markdown
## AgentPayments (EVM agent-token payment engine)

EVM port of the Solana `pump_agent_payments` program. One deployment per chain
serves every agent token on that chain. Deploy + wiring guide:
[`AGENT_PAYMENTS.md`](AGENT_PAYMENTS.md). Source: [`src/AgentPayments.sol`](src/AgentPayments.sol).
Owner = protocol/global buyback authority (set to the platform multisig).

Unlike `ThreeWSPayments`, the constructor takes only `owner` (no chain-specific
immutable), so a CREATE2 deploy via `ThreeWSFactory` with a shared salt yields the
**same** address on every chain. Plain `new` deploys produce per-chain addresses
(nonce-dependent) - fill in whichever you used.

| Chain | Chain ID | AgentPayments | Owner | Routers allow-listed | Tx |
| --- | --- | --- | --- | --- | --- |
| Ethereum | 1 | todo: fill after deployment | todo | todo | todo |
| Base | 8453 | todo: fill after deployment | todo | todo | todo |
| Arbitrum One | 42161 | todo: fill after deployment | todo | todo | todo |
| Polygon | 137 | todo: fill after deployment | todo | todo | todo |
| BNB Smart Chain | 56 | todo: fill after deployment | todo | todo | todo |
| Avalanche | 43114 | todo: fill after deployment | todo | todo | todo |

After filling a row, set the matching `agentPayments` address in
[`agent-payments-sdk/src/evm/addresses.ts`](../agent-payments-sdk/src/evm/addresses.ts)
and run `npm run build` in `agent-payments-sdk/`.
~~~~

### `contracts/DEPLOYMENTS.md` (section "Base deploy status - LIVE, bytecode confirmed (re-verified 2026-06-15)")

~~~~markdown
### Base deploy status - LIVE, bytecode confirmed (re-verified 2026-06-15)

The earlier "tx mined but address has no code → treat as **not deployed**" note was
**wrong** - a stale/unsynced RPC reading at deploy time. The deploy succeeded. Proof,
re-checked on-chain against live Base RPC:

- Deploy tx [`0xb6fcf60b…`](https://basescan.org/tx/0xb6fcf60b4ca16d25e135f91046107e78518fca9aa4f180d5110a5116bcdfe4d0)
  emitted `Deployed(addr=0x31B13cDe…, salt=0x5ef7540f…)` from `ThreeWSFactory` - so the
  predicted address **is** the deployed address (no CREATE2 collision, no salt mismatch).
- `eth_getCode(0x31B13cDe…)` returns **1243 bytes** (non-empty). `owner()` →
  `0x4022de2D36C334E73C7a108805Cea11C0564f402` (the deployer EOA, as on BSC/Arbitrum),
  and Base USDC `0x833589fCD6…` is embedded as the `USDC` immutable (BSC USDC is not).
- Independently re-derived: compiling the in-repo source (`contracts/ThreeWSPayments.sol`,
  solc `0.8.35`, optimizer 200) reproduces the **exact** recorded BSC init-code hash
  `0xb55479df…` and live BSC address - confirming source + settings are byte-for-byte
  correct - and CREATE2(`factory`, salt, Base-USDC init code) → `0x31B13cDe…`. The Base
  init-code hash is `0x253291817df177b537145a05d0221065be924cffa606b387221b5c6bf8f1c475`.
  (1243 bytes runtime, vs BSC's 1278, differs only because each chain's USDC enters the
  constructor as an immutable.)

**Basescan verification: PENDING (not yet verified).** Source + exact settings are
captured in-repo; run `scripts/verify-threews-payments-base.mjs` with a
`BASESCAN_API_KEY` set to publish (constructor args:
`(0x4022de2D…, 0x833589fCD6…)`). The script prints the Standard JSON Input bundle for
manual UI verification when no key is present.
~~~~

