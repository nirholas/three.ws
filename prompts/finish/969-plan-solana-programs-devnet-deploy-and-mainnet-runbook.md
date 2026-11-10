# Deploy the four built Solana programs to devnet, smoke-test them, and ship a one-command mainnet runbook

**Status 2026-11-04:** program ids rotated and committed, deploy planner/gated deploy script, onchain preflight and smoke scripts written. Devnet deploy NOT done: the devnet faucet is rate limited and payer G57Hd6u15bnvt1iNH9HW7DmgJ6Sq1hkZuxgdMFp9R5N3 holds 0 SOL. Remaining command after funding it: `node scripts/deploy-solana-programs.mjs --cluster devnet --keypair .deploy/devnet-payer.json --max-len-factor 1 --yes`, then the two smoke scripts. Mainnet broadcast is an owner gate (docs/ops/solana-programs-mainnet.md).

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

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

Code and config the reviewer cited alongside these docs (read them in the repo; they are not copied here): `contracts/agent-invocation/Anchor.toml`, `scripts/agent-invocation-smoke.mjs`, `api/_lib/agent-invocation-onchain.js`.

- `contracts/README.md`
- `contracts/AUDIT-README.md`
- `contracts/skill-license/DEPLOYMENT.md`
- `contracts/agent-invocation/README.md`
- `contracts/knock-escrow/README.md`
- `contracts/event-markets-stake/README.md`
- `docs/event-markets-staking.md` (section "Owner steps (one command each)")
- `agent-protocol-sdk/README.md`
