# Staked Event Markets proven end to end on devnet, with a $THREE buyback executor and a one-command mainnet launch kit

**Status (2026-11-04):** DONE-PENDING-OWNER (devnet funding). Committed in `beb1ab428`: guarded `buyback` command (`api/_lib/event-markets/staking/buyback.js`), `scripts/event-markets-stake-launch-plan.mjs` with live preflight, `scripts/event-markets-stake-devnet-e2e.mjs`, reconcile cron `/api/cron/event-markets-staking-reconcile` (scheduled in vercel.json, takes effect at the next deploy/cron sync), admin-gate test, env docs, `docs/ops/event-markets-stake-launch.md`, README hash line. 37 tests pass. The program id is `6DsLYSQcYZSegSKgRkRMP93L7uHxvV1cQhm6YoXa9xXU` (this order's id is wrong). Not done: the devnet deploy and e2e run (deployer `G57Hd6u15bnvt1iNH9HW7DmgJ6Sq1hkZuxgdMFp9R5N3` holds 0 devnet SOL and the faucet RPC is closed, so the owner funds it at faucet.solana.com, then `node scripts/deploy-solana-programs.mjs --cluster devnet --keypair .deploy/devnet-payer.json --max-len-factor 1 --yes` and `node scripts/event-markets-stake-devnet-e2e.mjs`); the browser panel check (task 4) needs that deployment and a local DB; the e2e drives the on-chain builders directly, HTTP-route coverage is still to run once deployed.

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/973-plan-event-markets-staking-devnet-proof-and-launch-kit.md`.

**Priority:** Gated, the last step needs an owner action or outside party (score 57 of 100 inside the tier). **Area:** event-markets. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Staked Event Markets (a parimutuel stake program on Solana with a 3% fee, 50% of which funds a $THREE buyback) is fully built but "not deployed to any cluster": the Anchor program, server, admin page and CLI exist and were only exercised on a local validator. Nothing proves it works on a public cluster against the real RPC, real token programs and the production code path, the fee's $THREE buyback leg is explicitly "not built here", and the eight owner steps are a prose list. Until it is proven on devnet and the mainnet launch is reduced to a short, gated command sequence, a revenue line and a $THREE demand loop stay dark. Real mainnet deployment, funding keys, the external audit and the legal sign-off are the owner's; everything else is agent work.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Program source: `contracts/event-markets-stake/` (Anchor 0.31, about 600 lines, unaudited, README lists the instructions). Local suite: `npm run test:stake-program` runs `scripts/test-event-markets-stake.mjs`, which builds with `cargo build-sbf`, boots `solana-test-validator`, and runs `tests/event-markets-staking.chain.test.js`. `which cargo solana solana-test-validator anchor` found none of them on this machine.
- Program id `6EHBAEEFZ9J8EUq9gLA6x1Kpbaanfvz55YSy9FiYs9W1`, tests `tests/event-markets-staking.test.js` and `tests/event-markets-staking.chain.test.js` (local validator). Not done: devnet deploy and a recorded end-to-end run, external audit (owner), mainnet keys, deploy and flag. The devnet deploy of this same program may also be done by the `solana-programs-devnet-deploy-and-mainnet-runbook` order; if it already is (check Step 0), reuse that deployment and skip the deploy in task 2.
- Server: `api/_lib/event-markets/staking/` (`chain.js`, `config.js`, `gate.js`, `limits.js`, `math.js`, `program.js`, `reconcile.js`, `record.js`, `routes.js`, `service.js`, `store.js`). Migration `api/_lib/migrations/20261013000000_event_market_staking.sql` exists. UI: `src/event-markets/staking-panel.js`, admin page `pages/event-markets-staking-admin.html`. Unit tests: `tests/event-markets-staking.test.js`.
- Owner CLI `scripts/event-markets-stake-admin.mjs` has `init`, `create-pool`, `resolve`, `void`, `pause`, `resume`, `status`, all dry-run until `--yes` (and `--confirm-mainnet` on mainnet). It has no buyback command.
- `api/_lib/event-markets/staking/config.js` defaults `EVENT_MARKETS_STAKE_CLUSTER` to `devnet`, already knows the devnet USDC mint (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`) and takes the $THREE mint from `THREE_TOKEN_MINT`. The flag `EVENT_MARKETS_STAKING_ENABLED` is unset.
- Production `GET https://three.ws/api/event-markets` currently returns `items: []`, so there is no live market to attach a pool to on mainnet; staking also requires an open market.
- The doc's counsel questions (jurisdiction, age, KYC, whether a buyback funded by wagering fees changes how $THREE is characterized) are owner/legal and are not agent work. Defaults shipped: blocked regions list and minimum age 21.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
which cargo solana solana-test-validator anchor
ls contracts/event-markets-stake/target/deploy 2>&1 | head
grep -n "buyback" scripts/event-markets-stake-admin.mjs | head
grep -rn "EVENT_MARKETS_STAK" .env.example docs/ops 2>/dev/null | head
npm run db:status
curl -s https://three.ws/api/event-markets | head -c 300
npx vitest run tests/event-markets-staking.test.js
solana program show 6EHBAEEFZ9J8EUq9gLA6x1Kpbaanfvz55YSy9FiYs9W1 --url devnet 2>&1 | head -3
sed -n 88,110p docs/event-markets-staking.md
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Toolchain: if the Solana/Anchor toolchain is missing, install it into the user's home (Agave `solana-install`, `cargo`, `avm` for Anchor 0.31 per `contracts/event-markets-stake/Cargo.toml`) without touching the repo. Run `npm run test:stake-program` and fix any rot (SDK drift, `@solana/web3.js` version, token-2022 helpers). If a failure is a program bug, add a failing chain test first, then fix the program.
2. Devnet deployment (no real spend, devnet SOL from the faucet): generate throwaway authority and resolver keypairs outside the repo, airdrop devnet SOL with retry across RPC providers (fund from a second throwaway wallet if rate limited), `cargo build-sbf`, `solana program deploy ... --url devnet`, and set `EVENT_MARKETS_STAKE_PROGRAM_ID`, `EVENT_MARKETS_STAKE_CLUSTER=devnet`, `EVENT_MARKETS_STAKE_AUTHORITY_KEYPAIR`, `EVENT_MARKETS_STAKE_RESOLVER_KEYPAIR` in a local, uncommitted env file. Apply the migration to a local or branch database only (`npm run db:status` first; never to production from this order).
3. Public-cluster end-to-end script `scripts/event-markets-stake-devnet-e2e.mjs` (committed, idempotent, prints a report): creates a devnet test token mint (devnet USDC mint is not mintable by us, so create an SPL mint and a Token-2022 mint and register them via the existing `TOKENS` config override for devnet), `init`, `create-pool` for a local test market, three funded test wallets stake on two outcomes through the real HTTP routes (`GET/POST /api/event-markets/:slug/staking[/attest|/stake|/payout|/record]` served by `npm run dev`), lock, resolve, winners `claim`, a second pool voided with every staker refunded, a third pool left to `void_expired` (use a short `--lock-grace-seconds`/void window via a devnet-only config so the expiry path runs in minutes), and finally runs the reconciliation (`api/_lib/event-markets/staking/reconcile.js`) and asserts `vault == totalStaked - feePaid - paidOut` and that each payout equals the JS preview to the base unit. Assert payout math equals the pool formula within one base unit. Save the transaction signatures in the output. (Also expose it under the name `scripts/qa-event-markets-stake-devnet.mjs` only if some doc or package script already references that name; otherwise one script.)
4. Panel check in a real browser against the local server with `EVENT_MARKETS_STAKING_ENABLED=1` and devnet: eligible viewer path (attest, preview, stake, confirm with a devnet wallet), blocked-region path (set the geo header), paused path, over-cap path, and every market-page state (loading skeleton, empty pool, error, resolved) showing pool totals, odds and claim state, plus keyboard focus and hover states. Capture console and network: no errors, real RPC calls.
5. Build the $THREE buyback executor (the doc marks it "not built here"): first run `grep -rln "buyback" api/cron api/_lib scripts` and reuse the platform's existing swap path (`api/_lib/vault-jupiter.js`, `api/_lib/pump-swap-ix.js`, whichever is already used for $THREE buys) rather than writing a new one. Add `buyback` to `scripts/event-markets-stake-admin.mjs`: reads the fee-token balance of the configured buyback wallet, quotes a swap to $THREE (`THREE_TOKEN_MINT`), prints the confirmation table (cluster, wallet, input token and amount, expected $THREE out, slippage bound, price impact) and does nothing without `--yes` (and `--confirm-mainnet` on mainnet), with a hard max-slippage and a minimum-out guard. Unit-test the quote/guard logic with injected quote data in `tests/event-markets-staking-buyback.test.js`; exercise the transaction build against devnet or simulation only.
6. Launch kit: add `scripts/event-markets-stake-launch-plan.mjs` that prints, read-only, the exact ordered mainnet sequence with every value filled from the environment (program build hash, program id, authority and resolver pubkeys, treasury and buyback destinations, token mints, fee bps, caps) plus a preflight checklist computed from live state (keys present and distinct from the economy wallets, migration applied, flag state, RPC reachable, a live open market exists, `reconcile` clean) and exits non-zero if any preflight fails. Fold the eight "Owner steps" in `docs/event-markets-staking.md` into this output so the doc points at the script.
7. Write `docs/ops/event-markets-stake-launch.md`: audit checklist, key custody, the exact mainnet command list with expected output, rollback (flag off, pool void) and monitoring queries; make sure `scripts/event-markets-stake-admin.mjs` refuses mainnet without `--confirm-mainnet` and prints the confirmation table, covered by a passing test. The launch-plan script from task 6 is linked from it.
8. Production readiness details that need no owner: add the new env vars to `.env.example` and `docs/ops/` (grep for the right runbook), add the staking reconciliation to an existing cron or health check if it is not wired (`grep -rn reconcile api/cron`), make sure `/admin/event-markets-staking` is admin-gated (assert in a test), and record the audited program hash expectation in the README so a later deploy can be compared (`solana program dump` hash).
9. Docs: update `docs/event-markets-staking.md` status line to "proven on devnet on <date>" with the signatures, rewrite the owner steps around the launch-plan script, add the buyback command to the CLI header comment, and `data/changelog.json` entry.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npm run test:stake-program` passes locally (toolchain installed in task 1), and `npx vitest run tests/event-markets-staking.test.js tests/event-markets-staking-buyback.test.js` passes.
- [ ] `node scripts/event-markets-stake-devnet-e2e.mjs` exits 0 and prints devnet signatures for create, stake x3, resolve, claim, void, refund and `void_expired`, plus a reconciliation line showing zero drift.
- [ ] `node --env-file=.env scripts/event-markets-stake-admin.mjs buyback` (no flags) prints the confirmation table and "Dry run" and sends nothing; with `EVENT_MARKETS_STAKE_CLUSTER=mainnet` and no `--confirm-mainnet` it refuses even with `--yes`.
- [ ] `node scripts/event-markets-stake-launch-plan.mjs` prints the ordered mainnet steps and a preflight table, exiting non-zero with the stock environment (no keys), and 0 with the devnet test environment.
- [ ] The admin script's mainnet refusal without `--confirm-mainnet` is covered by a passing test, and `docs/ops/event-markets-stake-launch.md` exists.
- [ ] Browser verification described in task 4 completed with zero console errors.
- [ ] Production stays untouched: `curl -s https://three.ws/api/event-markets/<any slug>/staking` still reports staking disabled.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| `cargo build-sbf` / `solana-test-validator` not installed or version mismatch | Install Agave and Anchor 0.31 into `$HOME` (`sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`, `cargo install --git https://github.com/coral-xyz/anchor avm`), pin versions to `Cargo.toml`/`Anchor.toml`. |
| Devnet faucet rate limit | Retry with smaller airdrops, rotate the public RPC, or use the project's devnet funding script (`grep -rn requestAirdrop scripts/`); keep working on UI and buyback tasks meanwhile. |
| No devnet market exists locally | Create one through the existing admin route/script (`scripts/` event-markets helpers or `/admin/event-markets`), never insert fake rows into production. |
| Program toolchain mismatch with the version documented by the test suite | Pin to the versions in `Cargo.toml`/`Anchor.toml`; the suite documents them |
| Devnet USDC mint is not mintable | Create your own SPL and Token-2022 test mints on devnet and point the devnet `TOKENS` override at them in a test-only config path. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Gate 1 (spend and on-chain): deploying the program to mainnet, funding and initialising the mainnet config, creating a mainnet pool, enabling the flag in production, and executing a real $THREE buyback are all irreversible spend or on-chain writes. This order does none of them. The external program audit and the jurisdiction/age/KYC decisions in section 8 of the doc are owner and counsel decisions. At the end, batch one message to the owner containing the launch-plan output (recipient wallets, amounts, token and chain for each step) and stop for an explicit yes.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/973-plan-event-markets-staking-devnet-proof-and-launch-kit.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `973-plan-event-markets-staking-devnet-proof-and-launch-kit.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

- `docs/event-markets-staking.md`
- `docs/event-markets.md`
- `docs/prompts/event-markets/10-staked-markets-solana.md`
- `docs/event-markets-staking.md` (section "Owner steps (one command each)")
