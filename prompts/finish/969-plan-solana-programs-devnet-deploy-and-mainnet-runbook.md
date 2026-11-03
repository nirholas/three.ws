# Deploy the four built Solana programs to devnet, smoke-test them, and ship a one-command mainnet runbook

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/969-plan-solana-programs-devnet-deploy-and-mainnet-runbook.md`.

**Priority:** Gated, the last step needs an owner action or outside party (score 66 of 100 inside the tier). **Area:** solana. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Four Solana programs are written, unit-tested against real bytecode in LiteSVM, and wired into the API, yet none exists on any cluster. `skill_license` (on-chain skill access NFTs), `agent_invocation` (verifiable agent-to-agent calls), `knock_escrow` (priced messages held in escrow, used by `api/knock/*` and `src/knock/page.js`) and `event_markets_stake` (parimutuel staking for Event Markets, off behind `EVENT_MARKETS_STAKING_ENABLED`) all return "account not found" on both devnet and mainnet today, so every route that depends on them degrades to its off-chain fallback or cannot be turned on. Solana is the home chain; these are the on-chain half of several Solana-native products. `agent_invocation` also has an SDK (`agent-protocol-sdk`), an API helper (`api/_lib/agent-invocation-onchain.js`) and a smoke script that have never had a program to run against, and its deploy authority secret named in its README is not in Secret Manager. Everything except the final mainnet broadcast is agent-doable on devnet for free.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `getAccountInfo` on devnet and mainnet-beta for all four ids returns `value: null`: `EdngSwxmDktyrr4phwGEZnCXEoQ27vgnBtowjhKa7Wr8` (skill_license), `AgEntJDMi1A7UadCoYcx6Fm3gusNk8SHLCi7vSUa4Zfo` (agent_invocation), `uVX46U6sGUs6PD3339ZXbTpMyhZwkQhBLPxnvRX9ps7` (knock_escrow), `6EHBAEEFZ9J8EUq9gLA6x1Kpbaanfvz55YSy9FiYs9W1` (event_markets_stake).
- The program keypairs for those ids are NOT in the repo (`contracts/skill-license/.deploy/` does not exist; `contracts/*/target/` is gitignored). A program can only be deployed to its declared id with the matching keypair. If no keypair can be recovered, the id must be regenerated: update `declare_id!` in each `src/lib.rs`, each `Anchor.toml`, the IDLs in `contracts/idl/`, and the hard-coded constants (`src/knock/escrow-program.js`, `api/_lib/knock/escrow.js` have `KNOCK_ESCROW_PROGRAM_ID` as a literal; skill_license, agent_invocation and event_markets_stake accept env overrides `SKILL_LICENSE_PROGRAM_ID`, `AGENT_INVOCATION_PROGRAM_ID`, `EVENT_MARKETS_STAKE_PROGRAM_ID`).
- Existing tooling: `scripts/skill-license-smoke.mjs`, `scripts/agent-invocation-smoke.mjs`, `scripts/event-markets-stake-admin.mjs` (confirmation table, `--yes`, `--confirm-mainnet`), `npm run test:stake-program`, and the LiteSVM crate `contracts/program-tests/` (42 tests). There is no knock_escrow devnet smoke script and no single deploy tool that covers all four.
- agent_invocation specifics: its id has a vanity `AgEnt` prefix, so a lost keypair is replaced by grinding a new `AgEnt` key with `workers/vanity-grinder` (CPU only, no spend). `contracts/agent-invocation/README.md` says the deploy authority lives in Secret Manager as `AGENT_INVOCATION_DEPLOY_AUTHORITY` (the skill_license equivalent is `SKILL_LICENSE_DEPLOY_AUTHORITY`); verify with `gcloud secrets list` and reconcile the wording with reality. `api/_lib/agent-invocation-onchain.js` defaults `AGENT_INVOCATION_NETWORK` to `mainnet` (line 136), which targets an undeployed program. `scripts/onchain-smoke.mjs --only=solana-invoke` also exercises it.
- Tests that already cover the JS side: `tests/knock-escrow-program.test.js`, `tests/knock-escrow-pda.test.js`, `tests/skill-license-onchain.test.js`, `tests/api-knock-escrow-sync.test.js`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
for id in EdngSwxmDktyrr4phwGEZnCXEoQ27vgnBtowjhKa7Wr8 AgEntJDMi1A7UadCoYcx6Fm3gusNk8SHLCi7vSUa4Zfo uVX46U6sGUs6PD3339ZXbTpMyhZwkQhBLPxnvRX9ps7 6EHBAEEFZ9J8EUq9gLA6x1Kpbaanfvz55YSy9FiYs9W1; do
  for c in api.devnet.solana.com api.mainnet-beta.solana.com; do
    echo -n "$id $c "; curl -s -X POST -H 'content-type: application/json' https://$c -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getAccountInfo\",\"params\":[\"$id\",{\"encoding\":\"base64\",\"dataSlice\":{\"offset\":0,\"length\":0}}]}" | grep -o '"value":[^,}]*'
  done
done
which solana anchor cargo-build-sbf; anchor --version 2>&1 | head -1
grep -n declare_id contracts/*/src/lib.rs
node scripts/onchain-smoke.mjs --only=solana-invoke 2>&1 | tail -5
grep -n AGENT_INVOCATION_NETWORK api/_lib/agent-invocation-onchain.js
ls contracts/skill-license/.deploy contracts/agent-invocation/target/deploy 2>&1 | head
# keypairs may live in Secret Manager or the Cloud Run env; names only, never print values
gcloud secrets list --project aerial-vehicle-466722-p5 2>/dev/null | grep -i "program\|keypair\|skill.license\|knock\|stake\|invocation\|vanity"
```

Skip any program already deployed and passing its smoke test.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Toolchain: install what is missing (Solana CLI, Anchor 0.31/0.32 to match each `Cargo.toml`, `cargo-build-sbf`) into the user home, never the repo. Build all four with `cargo-build-sbf` / `anchor build` and run `contracts/program-tests` (`cargo test`) and `npm run test:stake-program`; all must be green before any deploy.
2. Keypair recovery or regeneration: search the machine and Secret Manager for the program keypairs (names only). If a keypair for a declared id cannot be found, generate a new one per program (for agent_invocation grind a replacement `AgEnt` prefix key with `workers/vanity-grinder`), and update `declare_id!`, `Anchor.toml` (`[programs.*]`, all clusters), `contracts/idl/*.json`, the SDK constant in `agent-protocol-sdk/src`, the JS constants and defaults, the LiteSVM crate's id constants (`contracts/program-tests/src/lib.rs`), docs (`contracts/README.md`, `contracts/AUDIT-README.md`, `contracts/*/README.md`, `docs/event-markets-staking.md`) and tests. Keep new keypairs in the gitignored `.deploy/` dir at mode 600 and register them in Secret Manager under the names `contracts/skill-license/DEPLOYMENT.md` uses (for agent_invocation: `agent-invocation-program-keypair`, plus the dedicated devnet-only deploy authority as `AGENT_INVOCATION_DEPLOY_AUTHORITY`, fetched into a mode 600 temp file for the deploy and deleted afterwards); never commit or print a secret.
3. Devnet deploy (free): fund a throwaway devnet deployer by airdrop (retry across RPC lanes; if the public faucet is rate limited use the lanes listed in `api/_lib/` Solana RPC config), deploy all four programs to devnet, and record the deployed ids, deploy signatures and upgrade authority in a new `contracts/SOLANA_DEPLOYMENTS.md` (a table like `contracts/DEPLOYMENTS.md`).
4. Smoke tests against the real devnet deployments: run `scripts/skill-license-smoke.mjs` and `scripts/agent-invocation-smoke.mjs` (it must print the decoded `SkillInvoked` event) plus `node scripts/onchain-smoke.mjs --only=solana-invoke`; write `scripts/knock-escrow-smoke.mjs` (init config, open door, knock with a devnet SPL mint, answer and refuse paths, timeout refund) and extend `scripts/event-markets-stake-admin.mjs` usage into a `scripts/event-markets-stake-smoke.mjs` (init, create pool, stake both sides, resolve, claim, void and refund). Each exits non-zero on failure and prints explorer links.
5. Wire the API for devnet verification: set the program-id env overrides on a local `.env` only, then exercise `GET /api/skills/license-onchain`, `api/knock/escrowed.js` and `api/_lib/event-markets/staking/*` against devnet and add tests in `tests/` for any branch found broken. Fix defects test-first.
   For agent_invocation: add a cached `isProgramDeployed(network)` probe (executable account check) to `api/_lib/agent-invocation-onchain.js` so the invocation route reports a clear `program_not_deployed` error instead of a raw cluster rejection, change the `AGENT_INVOCATION_NETWORK` default to `devnet` until a mainnet deploy is recorded, and write `tests/agent-invocation-onchain.test.js` (instruction building and PDA derivation against fixed vectors, deployed-probe branches). Document `AGENT_INVOCATION_NETWORK`.
6. Write `scripts/deploy-solana-programs.mjs`: one command, `--cluster devnet|mainnet-beta`, builds, verifies the bytecode hash against the built `.so`, prints a confirmation table (cluster, program id, deploy authority, rent in SOL, upgrade authority, total cost) and does nothing without `--yes`, plus `--confirm-mainnet` on mainnet. Include `set-upgrade-authority` to a cold key as an explicit separate subcommand. Cover its planning logic (no signing) with a test in `tests/`.
7. Update `contracts/README.md`, `contracts/AUDIT-README.md`, `STRUCTURE.md` and `contracts/DEPLOYMENTS.md` pointers so "Not deployed" rows say "devnet <id>, mainnet pending" with the real ids. Add `contracts/agent-invocation/DEPLOYMENT.md` and update the `agent-protocol-sdk/README.md` status note with today's date and the devnet explorer link (no stale "not yet deployed" wording). Add the mainnet runbook (exact commands, expected SOL cost from the confirmation table, post-deploy `getAccountInfo` check, `solana-verify` verifiable build, upgrade-authority handover to the team multisig, env vars to set with `--update-env-vars`) as `docs/ops/solana-programs-mainnet.md`; the per-program DEPLOYMENT.md files link to it.
8. Prepare, but do not run, the mainnet step: the owner funds the deployer and approves the confirmation table. Add a developer-facing `data/changelog.json` entry and run `npm run audit:docs`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `getAccountInfo` on devnet for each of the four ids (as finally declared) returns a non-null executable account.
- [ ] `node scripts/skill-license-smoke.mjs`, `scripts/agent-invocation-smoke.mjs`, `scripts/knock-escrow-smoke.mjs`, `scripts/event-markets-stake-smoke.mjs` all exit 0 against devnet, with explorer links captured in `contracts/SOLANA_DEPLOYMENTS.md`.
- [ ] `solana program show <agent_invocation id> --url devnet` shows an executable program owned by the BPF upgradeable loader; `anchor test` passes in `contracts/agent-invocation`; `npx vitest run tests/agent-invocation-onchain.test.js` passes.
- [ ] `cargo test` in `contracts/program-tests` and `npm run test:stake-program` pass.
- [ ] `node scripts/deploy-solana-programs.mjs --cluster mainnet-beta` (no flags) prints the confirmation table and exits without signing.
- [ ] `grep -rn "declare_id" contracts/*/src/lib.rs` ids match the IDLs, the JS constants and the docs (a grep-based check committed as a test).
- [ ] No keypair file or secret appears in `git status`, and `git diff | grep -E '\[[0-9]+,[0-9]+,[0-9]+'` is empty.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Devnet airdrop rate limited | Retry across multiple devnet RPC lanes and with smaller amounts (1 SOL per request, several requests over time); each program deploy needs only a few SOL of devnet rent. |
| Program keypair for the declared id is lost | Regenerate the id (task 2) and update every reference; the id was only "reserved". |
| `cargo-build-sbf` / Anchor version mismatch | Install the toolchain version pinned in each `Cargo.toml` / `Anchor.toml` via `avm` / `solana-install`; do not edit program source to dodge a toolchain issue. |
| `anchor`/`solana` not installable in the sandbox | Run the build and deploy as a Cloud Build step on the `three-ws-build@` account with a throwaway builder image |
| Program too large for deploy | `solana program deploy --max-len` with headroom, or enable `--use-rpc`; check `.so` size first. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

The mainnet broadcast (program deploys cost real SOL rent and set an upgrade authority) is an irreversible spend action. Stop at the printed confirmation table (cluster, program id, deploy authority, rent, upgrade authority) and ask the owner for an explicit yes, batched into one message at the end. Everything on devnet runs without asking.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/969-plan-solana-programs-devnet-deploy-and-mainnet-runbook.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `969-plan-solana-programs-devnet-deploy-and-mainnet-runbook.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

Code and config the reviewer cited alongside these docs (read them in the repo; they are not copied here): `contracts/agent-invocation/Anchor.toml`, `scripts/agent-invocation-smoke.mjs`, `api/_lib/agent-invocation-onchain.js`.

### `contracts/README.md` (whole file)

~~~~markdown
# three.ws on-chain contracts

Every contract and program three.ws owns lives here: the Solidity set built with
[Foundry](https://book.getfoundry.sh/), and the three Solana programs built with
[Anchor](https://www.anchor-lang.com/). Solana is the home chain; the EVM
contracts are additional surfaces.

> **Reviewing these contracts?** Start at [`AUDIT-README.md`](./AUDIT-README.md):
> scope, deploy status, where the money is, the invariant ids, and the exact
> commands that reproduce every coverage and static-analysis number.

> **You probably do not need to deploy the ERC-8004 registries.** The canonical
> ERC-8004 reference contracts are already live at the same addresses on every
> major EVM chain, and [`../src/erc8004/abi.js`](../src/erc8004/abi.js) already
> points at them: identity `0x8004A169...` on mainnets, `0x8004A818...` on
> testnets. The registry sources here are a local reference implementation,
> useful if you need to fork, audit, or run a private deployment.

## What is in here

| Contract | Source | Role | Deploy status |
| --- | --- | --- | --- |
| `ThreeWSPayments` | [`ThreeWSPayments.sol`](./ThreeWSPayments.sol) | x402 pay-per-call USDC receiver | Live on BNB Smart Chain, Base, Arbitrum One. Custodies real USDC |
| `ThreeWSFactory` | [`ThreeWSFactory.sol`](./ThreeWSFactory.sol) | CREATE2 deployer behind the platform's vanity addresses | Live on the same three chains |
| `IdentityRegistry` | [`src/IdentityRegistry.sol`](./src/IdentityRegistry.sol) | ERC-8004 agents as ERC-721, EIP-712 delegated wallet, key/value metadata | Canonical ERC-8004 address live everywhere; not deployed from this tree |
| `ReputationRegistry` | [`src/ReputationRegistry.sol`](./src/ReputationRegistry.sol) | One signed score per reviewer per agent, aggregated on-chain | Same as above |
| `ValidationRegistry` | [`src/ValidationRegistry.sol`](./src/ValidationRegistry.sol) | Allow-listed validators attest to off-chain proofs (for example glTF-Validator reports) | Not deployed from this tree; the platform uses the ERC-8004 reference registry |
| `AgentPayments` | [`src/AgentPayments.sol`](./src/AgentPayments.sol) | Payments in, split into authority and buyback shares, buyback swaps and burns | Not deployed. See [`AGENT_PAYMENTS.md`](./AGENT_PAYMENTS.md) |
| `GreenfieldVault` | [`src/GreenfieldVault.sol`](./src/GreenfieldVault.sol) | Pay-to-unlock marketplace over a real BNB Greenfield cross-chain permission grant | Not deployed to a public chain; proven on an anvil fork |
| `WorldMoves` | [`src/WorldMoves.sol`](./src/WorldMoves.sol) | Event-only move stream for the Agora world. No value, no admin | Not deployed to a public chain |
| `SkinHook` | [`v4-hooks/src/SkinHook.sol`](./v4-hooks/src/SkinHook.sol) | Uniswap v4 hook: wearable 3D items as fixed-supply coins, wear-to-lock, in-swap creator royalty, referrer share | Not deployed. See [`v4-hooks/README.md`](./v4-hooks/README.md) |
| `AgentTierHook` | [`v4-hooks/src/AgentTierHook.sol`](./v4-hooks/src/AgentTierHook.sol) | Uniswap v4 hook: an ERC-8004 agent's reputation sets the LP fee it pays | Not deployed. Fork-tested against live Base |
| `skill_license` | [`skill-license/`](./skill-license) | Solana: a 1-of-1 NFT access key per purchased skill, revocable on refund | Not deployed. Program id reserved |
| `agent_invocation` | [`agent-invocation/`](./agent-invocation) | Solana: verifiable agent-to-agent invocation events | Not deployed. Program id reserved |
| `knock_escrow` | [`knock-escrow/`](./knock-escrow) | Solana: a priced message held in escrow that pays out only against a reply, and refunds in full otherwise | Not deployed. Program id reserved |

Per-address provenance and every chain id: [`DEPLOYMENTS.md`](./DEPLOYMENTS.md).

## Build and test the Solidity set

Install Foundry once:

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

Then, from this directory:

```bash
forge build
forge test
```

242 tests across 8 suites, all passing:

| Suite | Tests |
| --- | --- |
| `AgentPaymentsTest` | 57 |
| `GreenfieldVaultTest` | 41 |
| `IdentityRegistryTest` | 37 |
| `ReputationRegistryTest` | 31 |
| `ThreeWSPaymentsTest` | 22 |
| `ValidationRegistryTest` | 22 |
| `WorldMovesTest` | 19 |
| `ThreeWSFactoryTest` | 13 |

`forge test --summary` reprints that table. Dependencies (`forge-std`,
`openzeppelin-contracts`) are vendored under `lib/`, so no `forge install` step
is needed.

## Build and test the Solana programs

The invariant suite in [`program-tests/`](./program-tests) runs the real compiled
SBF bytecode in LiteSVM, so the bytecode has to exist before the tests run:

```bash
cd skill-license       && cargo-build-sbf
cd ../agent-invocation && cargo-build-sbf
cd ../knock-escrow     && cargo-build-sbf
cd ../program-tests    && cargo test
```

`cargo-build-sbf` ships with the Solana (Agave) toolchain, and `cargo test` needs
a host Rust toolchain:

```bash
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
```

A cold SBF build takes minutes per program; the tests themselves run in seconds.
Green is 42 tests: 21 for `skill_license`, 11 for `agent_invocation`, and 10 for
`knock_escrow`. The harness, the invariant ids, and the reason the LiteSVM clock
must be set are all documented in
[`program-tests/README.md`](./program-tests/README.md).

## Deploy the registries to Base Sepolia

Only needed for a private or forked deployment. The platform itself reads the
canonical registries.

1. Fund a deployer wallet with Base Sepolia ETH:
   https://www.alchemy.com/faucets/base-sepolia

2. Configure environment:

    ```bash
    cp .env.example .env
    # Fill in DEPLOYER_PK and BASESCAN_API_KEY
    ```

3. Deploy and verify:

    ```bash
    source .env
    forge script script/Deploy.s.sol:Deploy \
        --rpc-url $BASE_SEPOLIA_RPC_URL \
        --private-key $DEPLOYER_PK \
        --broadcast \
        --verify
    ```

    To rehearse without spending anything, point `--rpc-url` at a local
    `anvil` and use one of its funded dev keys. The script prints the three
    addresses and the `ValidationRegistry` owner either way.

4. Point the browser code at your deployment. In
   [`../src/erc8004/abi.js`](../src/erc8004/abi.js), `REGISTRY_DEPLOYMENTS[84532]`
   currently references the shared `TESTNET` constant that all seven supported
   testnets point at, so editing that constant would repoint every one of them.
   Replace the single entry with a literal instead:

    ```js
    84532: {
        identityRegistry: '0xYourIdentityRegistry',
        reputationRegistry: '0xYourReputationRegistry',
        validationRegistry: '0xYourValidationRegistry',
    },
    ```

## Deploy the registries to Base mainnet

Same as above with `$BASE_RPC_URL`, replacing the `8453` entry (which references
the shared `MAINNET` constant) the same way.

## After deploy: register three.ws itself

```js
// Browser console on three.ws with a wallet connected to Base Sepolia:
import { registerAgent } from './src/erc8004/index.js';
const r = await registerAgent({
    name: 'three.ws',
    description: 'AI-powered 3D model viewer & validation agent',
    glbFile: yourGlbFile, // a File; omit and pass glbUrl if it is already pinned
    onStatus: console.log,
});
console.log(r); // { agentId, registrationUrl, txHash, chainId }
```

Pinning uses the platform's built-in R2 backend by default. Pass
`apiToken: '<your Pinata JWT>'` to pin through your own Pinata account instead.
The full option list (2D image, auto thumbnail, declared services, x402 support)
is documented on `registerAgent` in
[`../src/erc8004/agent-registry.js`](../src/erc8004/agent-registry.js).

Then update
[`../public/.well-known/agent-registration.json`](../public/.well-known/agent-registration.json):

```json
"registrations": [
    { "agentId": 1, "agentRegistry": "eip155:84532:0xYourIdentityRegistryAddress" }
]
```

## Authorize a validator (for on-chain validation records)

The registry the platform actually reads and writes is the ERC-8004 reference
`ValidationRegistryUpgradeable`, which has no allowlist. A validator earns the
right to attest per agent, from the agent's owner:

```bash
# The agent's owner opens a request naming the validator, on the Identity
# Registry's terms (owner, per-token approval, or approval for all).
cast send $VALIDATION_REGISTRY \
    "validationRequest(address,uint256,string,bytes32)" \
    $VALIDATOR_ADDR $AGENT_ID "$REPORT_URI" $REQUEST_HASH \
    --rpc-url $BASE_SEPOLIA_RPC_URL \
    --private-key $OWNER_PK
```

To let a validator (for example the platform's) open requests itself, the owner
approves it as an operator instead: `approve(validator, agentId)` or
`setApprovalForAll(validator, true)` on the Identity Registry.

The validator then answers with
`validationResponse(requestHash, response, responseURI, responseHash, tag)`, which
the `recordValidation()` helper in
[`../src/erc8004/validation-recorder.js`](../src/erc8004/validation-recorder.js)
wraps (including the request leg when the same wallet owns the agent).

## Uniswap launcher (Base)

[`src/ThreeWsUniswapLauncher.sol`](./src/ThreeWsUniswapLauncher.sol) launches a fixed-supply token and its Uniswap V3
pool in one transaction, with a lock option (none, timelock, permanent) and fee routing. Its constructor takes
`(positionManager, weth, treasury, launchFeeWei, platformShareBps)`. Tests fork Base and run with:

```bash
export PATH=$PATH:$HOME/.foundry/bin
forge test --match-contract ThreeWsUniswapLauncherTest --fork-url $BASE_RPC_URL
```

Deploying it to mainnet and setting `UNISWAP_LAUNCHER_ADDRESS` on the API service is the owner's action. Until that
is set, `GET /api/launches/lanes` reports the lane as unavailable. See [../docs/launch-lanes.md](../docs/launch-lanes.md).

## Layout

```
contracts/
├── ThreeWSPayments.sol          live x402 USDC receiver
├── ThreeWSFactory.sol           live CREATE2 vanity deployer
├── src/
│   ├── IdentityRegistry.sol
│   ├── ReputationRegistry.sol
│   ├── ValidationRegistry.sol
│   ├── IIdentityRegistry.sol
│   ├── AgentPayments.sol
│   ├── GreenfieldVault.sol
│   ├── WorldMoves.sol
│   └── greenfield/              BNB Greenfield precompile interfaces
├── test/                        8 Foundry suites, 242 tests
│   └── mocks/                   MockGreenfield, Reentrant
├── script/                      Foundry deploy scripts, one per contract
├── skill-license/               Anchor program + DEPLOYMENT.md
├── agent-invocation/            Anchor program
├── knock-escrow/                Anchor program, escrowed pay-per-reply
├── program-tests/               LiteSVM invariant suite over the real bytecode
├── idl/                         vendored Anchor IDLs (ours plus the launchpad
│                                interfaces the platform reads; see idl/pump/README.md)
├── audit/                       committed Slither + Clippy output
├── vanity/                      CREATE2 salt grind artifacts
├── lib/                         vendored forge-std + openzeppelin-contracts
├── AUDIT-README.md              start here for a review
├── DEPLOYMENTS.md               address provenance per chain
├── AGENT_PAYMENTS.md            AgentPayments design notes
├── foundry.toml
└── .env.example
```
~~~~

### `contracts/AUDIT-README.md` (whole file)

~~~~markdown
# Audit pack: three.ws economy contracts

Start here if you are reviewing these contracts. This document is the single
entry point: what is in scope, what each contract is for, what it claims about
itself, what is already proven, what is already known, and the exact commands to
reproduce every number quoted below.

Nothing in this pack asks you to take a claim on trust. Every number has a command
next to it, and every "this is safe because" resolves to an invariant id whose
test you can run.

- **Invariants** (what the code claims must always be true): [`specs/ECONOMY_CONTRACT_INVARIANTS.md`](../specs/ECONOMY_CONTRACT_INVARIANTS.md)
- **Threat model** (assets, actors, failure modes): [`specs/ECONOMY_CONTRACT_THREAT_MODEL.md`](../specs/ECONOMY_CONTRACT_THREAT_MODEL.md)
- **Static analysis + dispositions**: [`audit/static-analysis.md`](./audit/static-analysis.md)
- **Deploy status and address provenance**: [`DEPLOYMENTS.md`](./DEPLOYMENTS.md)
- **Registration-layer threat model** (upstream of these contracts): [`specs/SECURITY.md`](../specs/SECURITY.md)

## Scope

The economy set is the code that moves value or records the economic state value
is priced against. The roadmap names three of them specifically: **reputation**
(`ReputationRegistry`), **royalty** (`AgentPayments` on EVM, `skill_license` on
Solana), and **delegation** (`IdentityRegistry`). The rest of the set is included
because it shares the same review surface and two of them are already live.

Solana leads on this platform, so the two Anchor programs are first-class scope,
not an appendix.

| Contract | Source | Lines | Role | Deploy status | Invariants | Tests |
|---|---|---|---|---|---|---|
| IdentityRegistry | [`src/IdentityRegistry.sol`](src/IdentityRegistry.sol) | 295 | Delegation: ERC-721 agent identity, EIP-712 wallet binding, per-agent balances, spend allowances | Canonical ERC-8004 address live on 12 mainnets + 7 testnets; bytecode read verified 2026-06-19. Deployed by the ERC-8004 reference project, not from this tree | `ID-1` .. `ID-11` | 37 |
| ReputationRegistry | [`src/ReputationRegistry.sol`](src/ReputationRegistry.sol) | 210 | Reputation: one review per reviewer per agent, optional refundable ETH stake | Same as above | `REP-1` .. `REP-10` | 31 |
| AgentPayments | [`src/AgentPayments.sol`](src/AgentPayments.sol) | 411 | Royalty (EVM): payments in, split into authority and buyback shares, buyback swaps and burns | Not deployed. Address table in `DEPLOYMENTS.md` is unfilled | `AP-1` .. `AP-13` | 57 |
| skill_license | [`skill-license/src/lib.rs`](skill-license/src/lib.rs) | 464 | Royalty (Solana): 1-of-1 NFT access key per purchased skill, revocable on refund | Not deployed. Program id reserved via `declare_id!`; runbook in [`skill-license/DEPLOYMENT.md`](skill-license/DEPLOYMENT.md) | `SL-1` .. `SL-8` | 21 |
| GreenfieldVault | [`src/GreenfieldVault.sol`](src/GreenfieldVault.sol) | 338 | Pay-to-unlock marketplace over a real BNB Greenfield cross-chain permission grant | Not deployed to a public chain; proven on an anvil fork | `GV-1` .. `GV-9` | 41 |
| ValidationRegistry | [`src/ValidationRegistry.sol`](src/ValidationRegistry.sol) | 166 | Allow-listed validators attest to off-chain proofs | Not deployed from this tree; the platform uses the ERC-8004 reference registry | `VR-1` .. `VR-6` | 22 |
| WorldMoves | [`src/WorldMoves.sol`](src/WorldMoves.sol) | 146 | Event-only move stream, no value, no admin | Not deployed to a public chain | `WM-1` .. `WM-4` | 19 |
| agent_invocation | [`agent-invocation/src/lib.rs`](agent-invocation/src/lib.rs) | 129 | Verifiable agent-to-agent invocation events, no value | Not deployed. Program id reserved via `declare_id!` | `AI-1` .. `AI-4` | 11 |
| **ThreeWSPayments** | [`ThreeWSPayments.sol`](ThreeWSPayments.sol) | 97 | x402 pay-per-call USDC receiver | **LIVE on BNB Smart Chain, Base, Arbitrum One.** Custodies real USDC | `TWP-1` .. `TWP-6` | 22 |
| **ThreeWSFactory** | [`ThreeWSFactory.sol`](ThreeWSFactory.sol) | 20 | CREATE2 deployer behind the platform's vanity addresses | **LIVE on the same three chains** | `TWF-1` .. `TWF-4` | 13 |

Cross-contract invariants (`X-1` .. `X-5`) apply to the whole set.

**Out of scope:** `lib/` (vendored OpenZeppelin and forge-std), `test/`, `script/`,
`src/greenfield/*.sol` (reproduced ABIs of already-deployed BNB Greenfield
contracts, included so this tree compiles against the real bridge), and
`contracts/idl/pump/*` (third-party IDLs consumed read-only).

## Where to spend your time

Ranked by what a mistake would cost, not by line count:

1. **`AgentPayments.buybackTrigger`** ([`src/AgentPayments.sol`](src/AgentPayments.sol)).
   The only place in the set that makes an arbitrary external call with
   caller-supplied calldata, while the contract holds every agent's revenue and
   long-lived payer allowances. Controls are an owner gate, a router allow-list, a
   token-address exclusion, a reentrancy guard, effects-before-interaction, a
   measured balance delta, and a same-call allowance reset. Threat rows `F-AP-2`,
   `F-AP-3`, `F-AP-9`.
2. **`AgentPayments` conservation** (`AP-7`). One identity governs custody:
   `paymentVault + buybackVault + withdrawVault + totalWithdrawn + totalBuybacks
   == totalPayments`, per `(agentToken, currencyToken)`. Any path that breaks it is
   a loss of funds.
3. **`ThreeWSPayments`** is live and holds real USDC. Small, but the only contract
   in the set where a finding is an incident rather than a bug.
4. **`IdentityRegistry` delegation** (`ID-3`, `ID-7`, `ID-8`). Signature replay and
   cross-agent balance isolation. Capturing a delegation is as valuable as
   capturing funds, and quieter.
5. **`skill_license` authority model** (`SL-1`, `SL-3`, `SL-5`). The marketplace
   deliberately keeps freeze authority over every license so refunds can revoke.
   Confirm that power cannot be reached by anyone but the minter.
6. **`GreenfieldVault` async settlement** (`GV-2`, `GV-6`, `GV-9`). Money moves at
   `buy()`, but the permission is minted later by a cross-chain ack. Every state
   machine gap lives in that window.

## Reproduce everything

### Solidity

Foundry, `solc 0.8.24`, optimizer on at 200 runs (see [`foundry.toml`](foundry.toml)).

```bash
cd contracts
forge build
forge test                                            # 242 tests, all passing
forge coverage --no-match-coverage "(script|test)"    # 100% lines/statements/branches/functions
```

Coverage as of 2026-08-14, and the standard this set holds:

| File | Lines | Statements | Branches | Functions |
|---|---|---|---|---|
| ThreeWSFactory.sol | 100% (6/6) | 100% (4/4) | 100% (2/2) | 100% (2/2) |
| ThreeWSPayments.sol | 100% (27/27) | 100% (26/26) | 100% (5/5) | 100% (9/9) |
| src/AgentPayments.sol | 100% (108/108) | 100% (149/149) | 100% (35/35) | 100% (14/14) |
| src/GreenfieldVault.sol | 100% (84/84) | 100% (118/118) | 100% (31/31) | 100% (8/8) |
| src/IdentityRegistry.sol | 100% (81/81) | 100% (94/94) | 100% (18/18) | 100% (20/20) |
| src/ReputationRegistry.sol | 100% (57/57) | 100% (67/67) | 100% (16/16) | 100% (10/10) |
| src/ValidationRegistry.sol | 100% (40/40) | 100% (43/43) | 100% (9/9) | 100% (10/10) |
| src/WorldMoves.sol | 100% (18/18) | 100% (21/21) | 100% (3/3) | 100% (6/6) |
| **Total** | **100% (421/421)** | **100% (522/522)** | **100% (119/119)** | **100% (79/79)** |

### Solana

The Anchor programs are tested against their **real compiled SBF bytecode** in
[LiteSVM](https://github.com/LiteSVM/litesvm), with the real SPL Token and
Associated Token Account programs loaded. Nothing is stubbed: a test failure means
the program is wrong.

```bash
cd contracts/skill-license    && cargo-build-sbf
cd contracts/agent-invocation && cargo-build-sbf
cd contracts/program-tests    && cargo test        # 32 tests, all passing
```

Line coverage is deliberately not quoted for these two. The unit under test is
bytecode executing inside a VM, so a host-side line-coverage tool would measure
the harness rather than the program. The coverage standard here is instruction and
invariant coverage instead, which is stronger and directly checkable:

| Program | Instructions | Instructions covered | Invariants | Positive + negative |
|---|---|---|---|---|
| `skill_license` | 5 (`initialize_marketplace`, `set_minter`, `mint_skill_license`, `burn_skill_license`, `revoke_skill_license`) | 5/5 | `SL-1` .. `SL-8` | every id |
| `agent_invocation` | 1 (`invoke_skill`) | 1/1 | `AI-1` .. `AI-4` | every id |

Seven of `skill_license`'s eight error variants are asserted by an
individually-named test. The eighth, `NotLicenseOwner`, is defense in depth behind
the PDA seed derivation: a stranger's derivation does not resolve to the victim's
license account, so the seeds constraint rejects the transaction first. The
stranger-burn test (`a_stranger_cannot_burn_someone_elses_license`) proves the
outcome that matters.

Harness details, including why the VM's clock must be set to a realistic value
before either program behaves correctly, are in
[`program-tests/README.md`](program-tests/README.md).

### Static analysis

```bash
cd contracts && slither . --filter-paths "lib/|test/|script/"      # 17 results, all dispositioned
cd contracts/skill-license && cargo clippy --all-targets
cd contracts/agent-invocation && cargo clippy --all-targets
```

Every result is dispositioned in writing in
[`audit/static-analysis.md`](./audit/static-analysis.md), with raw output
committed under [`audit/static-analysis/`](./audit/static-analysis).

## How invariants are proven

Every invariant has a stable id. The test that proves it names that id in a
comment, so the proof is greppable:

```bash
grep -rn "AP-7" contracts/test          # Solidity
grep -rn "SL-3" contracts/program-tests # Solana
```

Every id is covered by at least one positive test (the property holds when it
should) and at least one negative test (a caller trying to break it is rejected).
That rule is the reason the negative half is called out explicitly in each test's
doc comment.

## Known issues and accepted risks

These are already understood. If you find one of them, we agree; the value is in
what you find beyond them.

1. **`buybackTrigger` takes attacker-shaped input by construction.** Arbitrary
   calldata to an external address is what makes the contract DEX-agnostic. The
   residual risk after the allow-list and the token-address exclusion is execution
   quality (slippage, MEV), bounded by the buyback vault balance at call time.
2. **The skill-license marketplace keeps freeze authority** over every license mint,
   permanently, so refunds can revoke without the holder's signature. Intended, and
   asserted by `SL-3` rather than treated as a defect.
3. **`revoked_at == 0` is the "not revoked" sentinel** in `skill_license`. Safe on a
   real cluster (`Clock::unix_timestamp` is never 0) but it is a sentinel rather
   than a discriminated option. Changing it is an account-layout migration.
4. **Both Solana programs are upgradeable** by their deploy authority. Key custody
   is documented in [`skill-license/DEPLOYMENT.md`](skill-license/DEPLOYMENT.md).
5. **Nothing on EVM is upgradeable** (`X-1`). This removes proxy risk and adds
   migration risk: a fix is a redeploy plus a migration.
6. **Reputation sybil resistance is economic, not cryptographic.** The 0.001 ETH
   stake floor sets a price, it does not prevent a funded fleet. The market layer
   is expected to weight by stake size and staker history.
7. **`IdentityRegistry` has no admin recovery.** An owner who loses their key loses
   the agent, deliberately.
8. **`agent_invocation` events are a claim by the invoker**, not a receipt: the
   target does not sign. Settlement lives on the payments rail, not this log.
9. **The three registries this repo ships as reference implementations are not the
   bytecode live at `0x8004...` on most chains.** Consumers bind by address to
   whichever registry is canonical per chain. Read `DEPLOYMENTS.md` before assuming
   a source file corresponds to a live contract.

## Reporting

Send findings with a severity, a concrete failure scenario (inputs, ordering, and
the resulting wrong state), and the invariant id the finding breaks if one applies.
A finding that breaks a stated invariant is unambiguous by construction, which is
most of why the invariants are written down. Security contact and disclosure
process: [`.github/SECURITY.md`](../.github/SECURITY.md), or email security@three.ws.

## Repository map

```
contracts/
  AUDIT-README.md            this file
  DEPLOYMENTS.md             addresses, chains, provenance
  AGENT_PAYMENTS.md          AgentPayments deploy + wiring guide
  foundry.toml               solc 0.8.24, optimizer 200 runs
  src/*.sol                  the EVM economy set
  src/greenfield/*.sol       reproduced ABIs of live BNB Greenfield contracts
  test/*.t.sol               Solidity invariant tests
  skill-license/             Anchor program: skill licenses (Solana royalty half)
  agent-invocation/          Anchor program: invocation events
  program-tests/             LiteSVM invariant tests for both Anchor programs
  audit/                     static-analysis output and dispositions
  idl/                       generated IDLs consumed by the backend and SDKs
  script/                    Foundry deploy scripts
  vanity/                    CREATE2 salt records for the vanity addresses
```
~~~~

### `contracts/skill-license/DEPLOYMENT.md` (whole file)

~~~~markdown
# Deploying `skill_license`

The program id is the program keypair's pubkey, baked into `declare_id!` and
`Anchor.toml`: **`EdngSwxmDktyrr4phwGEZnCXEoQ27vgnBtowjhKa7Wr8`**. The same id is
used on localnet, devnet, and mainnet.

## Keys (never commit)

| Key | Purpose | Storage |
|---|---|---|
| Program keypair | Its pubkey is the program id; signs the initial deploy. | `contracts/skill-license/.deploy/skill_license-keypair.json` (gitignored) → secret manager as `SKILL_LICENSE_PROGRAM_KEYPAIR`. |
| Deploy/upgrade authority | Pays for + upgrades the program. | `~/.config/solana/skill-license-deployer.json` → `SKILL_LICENSE_DEPLOY_AUTHORITY`. |
| Minter | The backend wallet authorized to call `mint_skill_license` / `revoke_skill_license`. | `SKILL_LICENSE_MINTER_KEY` (base58 secret) in the server secret manager - never on the client. |

The program keypair generated for this id already lives at the gitignored
`.deploy/` path. If you need to regenerate (new id), update `declare_id!`,
`Anchor.toml`, `contracts/idl/skill_license.json`, and the default in
`api/_lib/skill-license-onchain.js`.

## 1. Build

```bash
cd contracts/skill-license
anchor build            # → target/deploy/skill_license.so + refreshed IDL
```

`anchor build` regenerates the IDL from `src/lib.rs`. Diff it against
`../idl/skill_license.json` and reconcile any drift (the JSON is the version the
backend + smoke test consume).

## 2. Deploy

```bash
# point the program keypair into place first
cp .deploy/skill_license-keypair.json target/deploy/skill_license-keypair.json

anchor deploy \
  --provider.cluster devnet \
  --provider.wallet ~/.config/solana/skill-license-deployer.json \
  --program-keypair target/deploy/skill_license-keypair.json
```

Repeat with `--provider.cluster mainnet` for production.

## 3. Initialize the marketplace (one-time)

The singleton `Marketplace` config must exist before any license can be minted.
Set `SKILL_LICENSE_MINTER_KEY` to the backend minter wallet and run:

```bash
SKILL_LICENSE_MINTER_KEY=<base58-secret> \
SOLANA_RPC_URL_DEVNET=https://api.devnet.solana.com \
node scripts/skill-license-smoke.mjs
```

On first run the smoke test initializes the marketplace (admin = minter), mints
a license to a fresh synthetic owner, verifies the on-chain record, and asserts
the buyer holds exactly 1 NFT. It is re-runnable and exits non-zero on failure.

To initialize with a **separate** admin authority (recommended for production - so the minter key can be rotated by a cold admin key), call
`buildInitializeMarketplaceIx({ authority, minter })` from
`api/_lib/skill-license-onchain.js` with distinct keys and submit it signed by
the admin.

## 4. Wire the backend

Set on the server (the `three-ws-api` Cloud Run service, via
`gcloud run services update three-ws-api --region us-central1 --update-env-vars ...`):

| Env | Value |
|---|---|
| `SKILL_LICENSE_PROGRAM_ID` | the deployed program id (optional; defaults to the baked id) |
| `SKILL_LICENSE_MINTER_KEY` | base58 secret of the authorized minter |
| `SOLANA_RPC_URL` / `SOLANA_RPC_URL_DEVNET` | RPC endpoints (already configured) |

Verification (`GET /api/skills/license-onchain`) needs only the RPC + program id.
Minting (`mintSkillLicenseOnchain`) also needs `SKILL_LICENSE_MINTER_KEY`. If the
minter key is absent, verification still works and minting is simply disabled - no crash.

## Upgrade authority

Keep the upgrade authority on a hardware/cold key in production. Transfer it
after the first deploy:

```bash
solana program set-upgrade-authority \
  EdngSwxmDktyrr4phwGEZnCXEoQ27vgnBtowjhKa7Wr8 \
  --new-upgrade-authority <COLD_AUTHORITY_PUBKEY>
```
~~~~

### `contracts/agent-invocation/README.md` (whole file)

~~~~markdown
# agent_invocation: verifiable agent-to-agent skill invocations (Solana / Anchor)

When one three.ws agent calls a skill on another agent, this program records
that call on-chain as a **verifiable event**. Anyone can replay the transaction
log and prove who invoked what, on whom, with which parameters, and when,
without trusting our database or either agent's own claims.

```
agent A (signer) --> invoke_skill("summarize", params) --> SkillInvoked event
                          |
                          +-- invoker_agent PDA  ["agent", A]  (proves A is A)
                          +-- target_agent  PDA  ["agent", B]  (proves B exists)
```

The program is intentionally non-trust-bearing: it moves no funds and grants no
capability. Its single job is identity-checked event emission, which makes it
the audit rail under three.ws agent-to-agent (A2A) coordination. This is the
"On-chain agent invocation" surface in [STRUCTURE.md](../../STRUCTURE.md); the
published client is [`@three-ws/agent-protocol-sdk`](../../agent-protocol-sdk/README.md).

Program id (same on every cluster, baked into `declare_id!`):
**[`AgEntJDMi1A7UadCoYcx6Fm3gusNk8SHLCi7vSUa4Zfo`](https://explorer.solana.com/address/AgEntJDMi1A7UadCoYcx6Fm3gusNk8SHLCi7vSUa4Zfo)**

## Agent identity: PDAs, not registrations

An agent's on-chain identity is a program-derived address, computed from the
wallet that controls it:

| Account | Seeds | Notes |
|---|---|---|
| `invoker_agent` | `["agent", invoker_authority]` | Re-derived and verified by Anchor `seeds`/`bump` constraints. The authority must sign, so a caller can only ever act as their own agent. |
| `target_agent` | `["agent", target_authority]` | Same derivation for the target. The target authority does not sign; only its pubkey is needed to re-derive the PDA. |

Because both agent accounts are constrained PDAs rather than raw `AccountInfo`,
an attacker cannot substitute an arbitrary account and have downstream
consumers trust it. There is no registration instruction and no rent: the PDA
derivation itself is the identity scheme. The SDK mirrors it in
[`deriveAgentPda`](../../agent-protocol-sdk/src/index.ts).

## Instructions

| Instruction | Signer | Effect |
|---|---|---|
| `invoke_skill(skill_name, parameters)` | `invoker_authority` | Validates lengths, verifies both agent PDAs, and emits a `SkillInvoked` event. No state is written. |

Limits enforced on-chain (and re-checked client-side by the SDK):
`skill_name` is 1 to 64 bytes, `parameters` is at most 512 bytes (typically a
JSON blob). Violations fail with `EmptySkillName`, `SkillNameTooLong`, or
`ParametersTooLong` from the program's `InvocationError` enum.

## The `SkillInvoked` event

Emitted via Anchor `emit!`, decodable with `anchor.EventParser` and the IDL:

| Field | Type | Meaning |
|---|---|---|
| `invoker_agent` | `Pubkey` | PDA of the calling agent |
| `target_agent` | `Pubkey` | PDA of the agent whose skill was invoked |
| `invoker_authority` | `Pubkey` | Wallet that signed the invocation |
| `skill_name` | `String` | Skill identifier (max 64 bytes) |
| `parameters` | `String` | Opaque parameter blob (max 512 bytes) |
| `timestamp` | `i64` | Cluster unix time at emission |

The hand-maintained IDL lives at
[`../idl/agent_invocation.json`](../idl/agent_invocation.json), kept in sync
with [`src/lib.rs`](src/lib.rs) and shipped inside the SDK as its `IDL` export.

## Usage

Most callers should not build instructions by hand; use the SDK:

```bash
npm install @three-ws/agent-protocol-sdk @solana/web3.js @coral-xyz/anchor
```

This example is the core of the devnet smoke test
([`scripts/agent-invocation-smoke.mjs`](../../scripts/agent-invocation-smoke.mjs)),
which runs it end-to-end against the live program and asserts every event field:

```js
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { invokeSkill, deriveAgentPda } from '@three-ws/agent-protocol-sdk';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

const invokerAuthority = Keypair.generate(); // must hold SOL; it signs and pays the fee
const targetAuthority = Keypair.generate().publicKey; // wallet owning the target agent

// The PDAs that will appear in the emitted event.
const [invokerAgent] = deriveAgentPda(invokerAuthority.publicKey);
const [targetAgent] = deriveAgentPda(targetAuthority);

const signature = await invokeSkill({
  connection,
  invokerAuthority,
  targetAuthority,
  skillName: 'summarize',
  parameters: JSON.stringify({ url: 'https://three.ws', lang: 'en' }),
});

console.log(`SkillInvoked: ${invokerAgent} -> ${targetAgent}`);
console.log(`https://explorer.solana.com/tx/${signature}?cluster=devnet`);
```

`invokeSkill` validates the length limits locally, derives both PDAs, builds
the `invoke_skill` instruction, and returns the confirmed signature. Pass
`programId` only when targeting a deployment other than the default id above.

## Build, test, deploy

The crate is a self-contained Cargo workspace (see [Cargo.toml](Cargo.toml)),
so builds here never walk up into an unrelated parent workspace:

```bash
anchor build                              # compile + verify against the IDL
anchor deploy --provider.cluster devnet   # program keypair = declare_id
anchor run smoke                          # devnet smoke test (defined in Anchor.toml)
```

The smoke test funds a fresh synthetic invoker (devnet airdrop, or a
`SMOKE_FUNDER_KEYPAIR` payer on other clusters), submits a real
`invoke_skill`, then parses the transaction logs and asserts each
`SkillInvoked` field matches what was sent. It exits non-zero on any mismatch.
Cluster config, program ids per cluster, and the deploy wallet path are in
[Anchor.toml](Anchor.toml); the deploy authority keypair is kept out of the
repo (Secret Manager: `AGENT_INVOCATION_DEPLOY_AUTHORITY`).

## Related surfaces

- [`agent-protocol-sdk/`](../../agent-protocol-sdk/README.md): the npm client
  (`invokeSkill`, `deriveAgentPda`, `IDL`, `AGENT_INVOCATION_PROGRAM_ID`,
  `MAX_SKILL_NAME_LEN`, `MAX_PARAMETERS_LEN`).
- [`../skill-license/`](../skill-license/README.md): sibling Anchor program
  minting on-chain skill-ownership NFTs; it follows this program's IDL
  convention.
- [`../README.md`](../README.md): the EVM contracts that share this
  `contracts/` directory.
~~~~

### `contracts/knock-escrow/README.md` (whole file)

~~~~markdown
# `knock_escrow`

Escrowed, refundable payments for a **knock**: a priced message to a person that
pays out only against a reply.

Program id: `uVX46U6sGUs6PD3339ZXbTpMyhZwkQhBLPxnvRX9ps7` (Solana, Anchor 0.31.1)

## Why this exists

The live knock product settles the sender's payment straight to the owner's
wallet the moment it clears. That works between people who already trust each
other and fails in an open market: the sender pays first and unconditionally, so
an owner can bank every knock and answer none. At volume the price signal stops
meaning anything, because paying a stranger stops being rational.

This program makes the money conditional. A knock parks the payment in a vault
owned by the knock's own PDA, and exactly three things can happen to it:

| Outcome | Who triggers it | Where the money goes |
| --- | --- | --- |
| **Answer** | the door's owner, inside the reply window | owner, minus the protocol fee |
| **Refuse** | the door's owner, inside the reply window | sender, in full, **no fee taken** |
| **Reclaim** | anyone, once the window has closed | sender, in full |

There is no fourth path. The `Config` authority sets the fee and treasury for
knocks made *after* it acts; it cannot touch a vault, answer on an owner's
behalf, or stop a refund. A sender's worst case is that their money is locked
until the window they agreed to expires.

Message bodies never touch the chain. A knock stores the SHA-256 of the message
and an answer stores the SHA-256 of the reply, so either side can later prove
what was sent without publishing a private message to a public ledger.

## Instructions

| Instruction | Signer | Effect |
| --- | --- | --- |
| `initialize(treasury, fee_bps)` | authority | Creates the singleton `Config` PDA. |
| `set_config(treasury?, fee_bps?, authority?)` | authority | Repoints fee, treasury, or authority for future knocks only. |
| `open_door(door_id, price, reply_window)` | owner | Opens a priced door for one SPL mint. |
| `set_door(price?, reply_window?, open?)` | owner | Reprices, retimes, or shuts a door. Knocks already in flight are untouched. |
| `knock(nonce, message_hash)` | sender | Moves `price` into the knock's vault and records the knock. |
| `answer(reply_hash)` | owner | Pays the owner, sends the fee to the treasury, closes the vault. |
| `refuse()` | owner | Refunds the sender in full and closes the vault. |
| `reclaim()` | anyone | After expiry, refunds the sender in full and closes the vault. |

`door_id` is a 32-byte client-chosen id (the product uses the SHA-256 of the
owner's username), so one wallet can run several doors without a second signer.
`nonce` lets one sender knock the same door repeatedly.

## Guarantees enforced in code

- **Fee ceiling.** `fee_bps` can never exceed 1000 (10%). An unbounded fee is a
  rug, so the bound lives in the program, not in an operator's discipline.
- **Fee snapshot.** A `KnockRecord` stores the fee that was in force when it was
  made, so an authority cannot reprice escrowed money after the fact.
- **Refusing is free.** `refuse` takes no fee. Declining to read something is
  not a service.
- **Terminal states are terminal.** A knock leaves `Pending` exactly once, into
  `Answered`, `Refused`, or `Refunded`.
- **Bounded windows.** A reply window is between 1 hour and 30 days, and a price
  is between 1 and 1_000_000_000 base units.
- **Checked math.** Fee and payout arithmetic returns `MathOverflow` rather than
  wrapping.

## State and events

Accounts: `Config` (singleton), `Door` (per owner + `door_id`, with lifetime
`knocks` / `answered` / `refunded` / `earned` counters), and `KnockRecord` (per
escrowed knock, alongside its vault token account).

Events: `Knocked`, `Answered`, and `Refunded` (whose `refused` flag separates an
owner declining from a window lapsing), so an indexer can rebuild door history
without polling accounts.

## Build

```bash
cd contracts/knock-escrow
cargo-build-sbf
```

The crate declares its own `[workspace]` so `cargo-build-sbf` never walks up
into an unrelated parent workspace. Build output lands in `target/deploy/` and is
gitignored, along with the program keypair.

Shared LiteSVM helpers for exercising a compiled program against the real SPL
Token and Associated Token Account programs live in
[`../program-tests/`](../program-tests).
~~~~

### `contracts/event-markets-stake/README.md` (whole file)

~~~~markdown
# event-markets-stake

Minimal Anchor program (0.31) for staked Event Markets: a parimutuel pool per market. Spec and decisions: [docs/event-markets-staking.md](../../docs/event-markets-staking.md). **Unaudited. Not deployed to any cluster.**

## Instructions

| Instruction | Who | Effect |
| --- | --- | --- |
| `initialize` | authority | Creates the config: resolver, fee destinations, fee bps, buyback share. |
| `set_config` | authority | Changes any config field, pauses or resumes, rotates the authority. |
| `create_pool` | resolver | New pool for a 32-byte id, with outcome count, min, max, pool cap, lock and void deadlines. Snapshots fee and destinations. |
| `stake` | anyone | Stakes on one outcome. A wallet can back one outcome per pool. |
| `lock` | resolver | Closes staking early. |
| `resolve` | resolver | Records the winner and pays the fee to the treasury and buyback accounts. |
| `void_pool` | resolver | Voids; every staker refunds in full. |
| `void_expired` | anyone | Voids an unresolved pool after `void_after_ts`. |
| `claim` | winner | Pays `floor(stake * (total - fee) / winning_total)`. One shot. |
| `refund` | staker | Returns the full stake from a void pool. One shot. |

`pause` stops `create_pool` and `stake` only. Claims, refunds and `void_expired` are never blocked.

PDAs: `["config"]`, `["pool", pool_id]`, `["position", pool, owner]`; the vault is the pool's associated token account. Supports SPL Token and Token-2022.

## Test

`npm run test:stake-program` builds the program, boots `solana-test-validator` with it loaded, runs [tests/event-markets-staking.chain.test.js](../../tests/event-markets-staking.chain.test.js) (full cycle, every error path, double claim, wrong authority, payout parity with the JS math, Token-2022), and stops the validator by PID. Needs the Solana CLI (`cargo-build-sbf`).

## Deploy

Owner-gated, see the step list in the decision record. Never commit `target/deploy/*-keypair.json`; `contracts/*/target/` is gitignored.
~~~~

### `docs/event-markets-staking.md` (section "Owner steps (one command each)")

~~~~markdown
## Owner steps (one command each)

Nothing below has been run. Fund-moving commands print recipient, amount, token and chain, and do nothing without `--yes` (and `--confirm-mainnet` on mainnet).

1. **Audit.** Have the program reviewed externally. Local suite: `npm run test:stake-program`.
2. **Generate the keys** (authority and resolver, hardware-backed in production): `solana-keygen new -o ~/.config/three-ws/stake-authority.json` and the same for the resolver; set `EVENT_MARKETS_STAKE_AUTHORITY_KEYPAIR` and `EVENT_MARKETS_STAKE_RESOLVER_KEYPAIR` to the file paths.
3. **Deploy the program.** `cd contracts/event-markets-stake && cargo build-sbf && solana program deploy target/deploy/event_markets_stake.so --program-id target/deploy/event_markets_stake-keypair.json --url mainnet-beta` (devnet first with `--url devnet`). Set `EVENT_MARKETS_STAKE_PROGRAM_ID`.
4. **Apply the migration.** `npm run db:status` then `npm run db:migrate` (20261013000000).
5. **Initialize the config.** `node --env-file=.env scripts/event-markets-stake-admin.mjs init --treasury <wallet> --buyback <wallet> --yes`
6. **Create a pool for a market.** `... create-pool --market <slug> --token usdc --yes`
7. **Enable the flag.** `gcloud run services update three-ws-api --region us-central1 --update-env-vars EVENT_MARKETS_STAKING_ENABLED=1,EVENT_MARKETS_STAKE_CLUSTER=mainnet`
8. **After a market resolves:** `... resolve --market <slug> --yes` (or `void` if nobody picked the winner).
~~~~

### `agent-protocol-sdk/README.md` (whole file)

~~~~markdown
<p align="center">
  <a href="https://three.ws"><img src="https://three.ws/three-ws-mcp-icon.svg" width="72" height="72" alt="three.ws" /></a>
</p>

<h1 align="center">@three-ws/agent-protocol-sdk</h1>

<p align="center"><strong>Record verifiable agent-to-agent skill invocations on Solana, via the <code>agent_invocation</code> Anchor program.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@three-ws/agent-protocol-sdk"><img alt="npm" src="https://img.shields.io/npm/v/@three-ws/agent-protocol-sdk?logo=npm&color=cb3837"></a>
  <a href="https://www.npmjs.com/package/@three-ws/agent-protocol-sdk"><img alt="downloads" src="https://img.shields.io/npm/dm/@three-ws/agent-protocol-sdk?color=cb3837"></a>
  <img alt="license" src="https://img.shields.io/npm/l/@three-ws/agent-protocol-sdk?color=3b82f6">
  <img alt="node" src="https://img.shields.io/node/v/@three-ws/agent-protocol-sdk?color=339933&logo=node.js">
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#api">API</a> ·
  <a href="#requirements">Requirements</a> ·
  <a href="https://three.ws">three.ws</a>
</p>

---

> Thin, typed client for the `agent_invocation` Solana program. One agent calls a
> skill on another agent; the call is validated client-side, built as an Anchor
> instruction, and submitted on-chain, where it emits a `SkillInvoked` event that
> anyone can verify. Built for three.ws agent-to-agent (A2A) coordination.

> **Program id, and where it stands.** `AGENT_INVOCATION_PROGRAM_ID` is
> [`AgEntJDMi1A7UadCoYcx6Fm3gusNk8SHLCi7vSUa4Zfo`](https://explorer.solana.com/address/AgEntJDMi1A7UadCoYcx6Fm3gusNk8SHLCi7vSUa4Zfo),
> the id baked into the program's `declare_id!` and therefore the same on every
> cluster. As of 2026-08-11 that account is **not yet deployed** on mainnet-beta
> or devnet: `invokeSkill` builds and signs a correct instruction, and the
> cluster rejects it until the program is published. Verify before you build on
> it (`solana account AgEntJDMi1A7UadCoYcx6Fm3gusNk8SHLCi7vSUa4Zfo`, or run
> `node scripts/onchain-smoke.mjs --only=solana-invoke` in the repo, which probes
> the cluster and reports the current state). Build and deploy instructions are
> in
> [`contracts/agent-invocation/README.md`](https://github.com/nirholas/three.ws/blob/main/contracts/agent-invocation/README.md).
> Once it is live, point `connection` at the cluster you want; the `programId`
> param stays optional and is only needed to target a different deployment.

## Install

```bash
npm install @three-ws/agent-protocol-sdk @solana/web3.js @coral-xyz/anchor
```

`@solana/web3.js` (`^1.98`) and `@coral-xyz/anchor` (`^0.32`) are direct
dependencies and are installed alongside the package.

## Quick start

```ts
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { invokeSkill } from '@three-ws/agent-protocol-sdk';

// mainnet-beta by default; use 'https://api.devnet.solana.com' for devnet.
const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
const invokerAuthority = Keypair.fromSecretKey(/* your secret key bytes */);
const targetAuthority = new PublicKey('<authority that owns the target agent>');

const signature = await invokeSkill({
  connection,
  invokerAuthority,                       // signs + pays
  targetAuthority,                        // target agent PDA is derived from this
  skillName: 'summarize',                 // 1-64 bytes
  parameters: JSON.stringify({ url: 'https://example.com' }), // <=512 bytes
  // programId is optional; it defaults to AGENT_INVOCATION_PROGRAM_ID.
});

console.log('invocation tx:', signature);
```

`invokeSkill` validates the inputs, derives both the invoker and target agent
PDAs, builds the `invoke_skill` instruction, submits it, and returns the
confirmed transaction signature.

## API

### `invokeSkill(params): Promise<string>`

Records a skill invocation from one agent to another and returns the confirmed
transaction signature.

| Param | Type | Description |
| --- | --- | --- |
| `connection` | `Connection` | Live Solana connection used to build and send the tx. |
| `invokerAuthority` | `Keypair` | Owns the invoking agent. Signs and pays. |
| `targetAuthority` | `PublicKey` | Owns the target agent; its PDA is re-derived from this. |
| `skillName` | `string` | Skill identifier, 1-64 bytes (UTF-8). |
| `parameters` | `string` | Opaque parameter blob, max 512 bytes (typically JSON). |
| `programId` | `PublicKey` *(optional)* | Override the program id. Required on any live cluster. |

Throws if `skillName` is empty, `skillName` exceeds `MAX_SKILL_NAME_LEN` bytes,
or `parameters` exceeds `MAX_PARAMETERS_LEN` bytes, so you get a clear local
error instead of a failed on-chain simulation.

### `deriveAgentPda(authority, programId?): [PublicKey, number]`

Derives an agent's program-derived address from the authority that owns it.
Matches the program's `seeds = [b"agent", authority]`. Pass your deployed
`programId` to derive against a live cluster; otherwise it uses
`AGENT_INVOCATION_PROGRAM_ID`.

```ts
import { deriveAgentPda } from '@three-ws/agent-protocol-sdk';

const [agentPda, bump] = deriveAgentPda(authority, programId);
```

### Constants & types

| Export | Type | Value / meaning |
| --- | --- | --- |
| `MAX_SKILL_NAME_LEN` | `number` | `64`, max `skillName` length in bytes. |
| `MAX_PARAMETERS_LEN` | `number` | `512`, max `parameters` length in bytes. |
| `AGENT_INVOCATION_PROGRAM_ID` | `string` | The program's `declare_id!` (`AgEnt…Zfo`), same on every cluster. |
| `IDL` | Anchor `Idl` | The `agent_invocation` IDL (Anchor 0.30+ format). |
| `AgentInvocation` | `type` | TypeScript type of `IDL` for `new Program<AgentInvocation>(...)`. |
| `InvokeSkillParams` | `interface` | Parameter shape for `invokeSkill`. |

### On-chain shape

The program exposes one instruction, `invoke_skill(skill_name, parameters)`, over
four accounts (`invoker_agent` PDA, `invoker_authority` signer, `target_authority`,
`target_agent` PDA) plus the system program. A successful call emits a
`SkillInvoked` event with `invoker_agent`, `target_agent`, `invoker_authority`,
`skill_name`, `parameters`, and a `timestamp`. The program's error codes
(`EmptySkillName`, `SkillNameTooLong`, `ParametersTooLong`) mirror the client-side
validation above.

## Requirements

- **Node** `>= 18`.
- **Peers / deps:** `@solana/web3.js@^1.98`, `@coral-xyz/anchor@^0.32`.
- **A funded invoker.** `invokerAuthority` signs and pays the transaction fee, so
  it needs a small SOL balance on the target cluster.
- **A deployed program.** `AGENT_INVOCATION_PROGRAM_ID` is not on-chain yet (see
  the note at the top); until it is, submitting an invocation fails at the
  cluster. Check the account before you depend on it.

## Links

- Homepage: https://three.ws
- Changelog: https://three.ws/changelog
- Issues: https://github.com/nirholas/three.ws/issues
- License: Apache-2.0, see [LICENSE](./LICENSE)

---

<p align="center">
  <sub>
    Part of the <a href="https://three.ws">three.ws</a> SDK suite: 3D AI agents, on-chain identity, and agent payments.<br/>
    <a href="https://three.ws">Website</a> · <a href="https://three.ws/changelog">Changelog</a> · <a href="https://github.com/nirholas/three.ws">GitHub</a>
  </sub>
</p>
~~~~

