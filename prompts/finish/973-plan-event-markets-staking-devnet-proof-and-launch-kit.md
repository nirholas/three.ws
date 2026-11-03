# Staked Event Markets proven end to end on devnet, with a $THREE buyback executor and a one-command mainnet launch kit

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

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/event-markets-staking.md` (whole file)

~~~~markdown
# Staked Event Markets on Solana

Status: built and tested on a local validator. Not deployed to any cluster. Off by default (`EVENT_MARKETS_STAKING_ENABLED` unset). The free-to-play picks remain the public product; staking is a second, separate panel that only appears for eligible viewers once the owner turns it on.

Legend: **[Rec]** is my recommended default, chosen so the owner is not interviewed. **[Owner]** is a decision only the owner (and counsel) can make. Every default lives in [api/_lib/event-markets/staking/config.js](../api/_lib/event-markets/staking/config.js) or on-chain config, so changing one is a one-line edit.

## What was built

| Piece | Where |
| --- | --- |
| Anchor program: create pool, stake, lock, resolve, claim, refund, void, permissionless expiry void | [contracts/event-markets-stake/](../contracts/event-markets-stake/README.md) |
| Server: unsigned stake and payout transactions, preview, gate, caps, ledger, reconciliation | [api/_lib/event-markets/staking/](../api/_lib/event-markets/staking/) |
| Routes | `GET/POST /api/event-markets/:slug/staking[/attest\|/stake\|/payout\|/record]` |
| Admin API and page | `/api/event-markets/staking-admin`, `/admin/event-markets-staking` |
| Owner CLI (every fund-moving command is dry-run until `--yes`) | [scripts/event-markets-stake-admin.mjs](../scripts/event-markets-stake-admin.mjs) |
| Stake panel on the market page | [src/event-markets/staking-panel.js](../src/event-markets/staking-panel.js) |
| Tests | [tests/event-markets-staking.test.js](../tests/event-markets-staking.test.js), [tests/event-markets-staking.chain.test.js](../tests/event-markets-staking.chain.test.js) |

The server never holds funds and never signs a stake. It returns a base64 transaction with the staker as fee payer and no signatures; the staker's own wallet signs after an explicit confirm. The only keys the platform holds are the program authority (config changes) and the resolver (create pool, lock, resolve, void). Neither can move a staker's funds to anywhere except the pool's own payouts and the fee destinations recorded in the pool at creation.

## Decision record

### 1. Model: parimutuel, 3% fee [Rec]

All stakes on a market go in one pool. Winners split the pool, minus the fee, in proportion to their stake on the winning outcome. There is no house counterparty and no price to take, so the platform carries no market risk.

```
fee      = floor(total * fee_bps / 10000)
payout   = floor(stake * (total - fee) / winning_total)
```

Rounding dust (a few base units) stays in the vault. The JS preview and the program use the same integer math; the chain test asserts equality to the base unit for every payout. Fee 3% (300 bps) [Rec]; the program hard-caps it at 10% so a bad config cannot take more. [Owner]: confirm the rate.

### 2. Stake tokens: USDC and $THREE [Rec]

One token per pool, chosen when the pool is created. Classic SPL and Token-2022 mints both work. USDC gives a stable unit; $THREE keeps the platform coin at the center. Devnet uses the devnet USDC mint and the real $THREE mint address from `THREE_TOKEN_MINT`. [Owner]: confirm the token list.

### 3. Fee split and buyback share [Rec]

50% of the fee goes to a $THREE buyback wallet, 50% to the treasury. Both destinations and the split are snapshotted into each pool at creation, so a later config change cannot redirect a live pool. The program transfers the fee at resolve time; the platform does not hold it. The buyback wallet only receives the fee token; executing the actual buyback is a separate owner-gated action and is not built here. [Owner]: split ratio, and the two destination wallets.

### 4. Limits [Rec]

| | USDC | $THREE |
| --- | --- | --- |
| Min stake | 1 | 1,000 |
| Max per account per market | 100 | 1,000,000 |
| Max pool per market | 5,000 | 50,000,000 |
| Daily per account (server) | 250 | 2,500,000 |

Min, per-account and pool caps are enforced on-chain as well as by the server. The daily cap is server-side. Small on purpose for a first launch. [Owner]: raise after the audit.

### 5. Timing [Rec]

- Staking closes at the market's `locks_at` (the on-chain `lock_ts`). The resolver can also lock early.
- The owner resolves on-chain after the platform market resolves; the winner is read from the platform's resolved row, never typed in.
- If the pool is not resolved within 7 days of the lock, anyone can void it (`void_expired`) and every staker refunds. This bounds the damage of a lost or compromised resolver key to a delay, never a loss.

### 6. Void, refund and the no-winner cases [Rec]

- **Void** (platform void, tie, cancellation, or expiry): every staker refunds their full stake. No fee is taken.
- **Nobody picked the winner:** the pool is voided and everyone refunds in full. The house does not keep losers' stakes when no one could have won. The CLI refuses to resolve in this case and points at `void`.
- **No contest** (every stake on the winner): nobody loses, so the pool refunds with no fee.
- Claims, refunds and `void_expired` can never be blocked by the kill switch or by pausing the program.

### 7. Safety controls

- Per-account and per-market caps (above), plus the daily cap.
- Instant kill switch: the admin page, or `pause` in the CLI. It stops new pools and new stakes only.
- Admin reconciliation page: for every pool, vault balance against `totalStaked - feePaid - paidOut`, and on-chain totals against recorded stakes. A short vault is flagged as the alarm case.
- Staked and free-to-play never share a leaderboard. Stakes are not points, never enter scoring, and the panel states this.
- Token names, symbols and entrant labels are untrusted data: a stake or payout is only ever built from the signed-in user's own request, the pool's recorded outcome ids and the user's wallet.

### 8. Jurisdiction and age gating [Owner]

I am not a lawyer and this is not legal advice. Staking real tokens on event outcomes is likely regulated as gambling, a wagering product or a derivative in many places. Open questions for counsel:

1. Which jurisdictions may the product serve at all, and is a licence needed anywhere it is offered?
2. Is a parimutuel prediction pool on platform-internal events (Arena results, bounties) treated differently from sports or political outcomes?
3. Minimum age. Default 21 [Rec] (the strictest common threshold).
4. Do the terms, KYC or sanctions screening need more than a self-attestation?
5. Does a buyback funded by wagering fees change how $THREE is characterized?

Defaults shipped [Rec], all editable by env: blocked regions `US,GB,FR,AU,SG,CN,KP,IR,CU,SY,RU,BY,MM,SD,SS` (`EVENT_MARKETS_STAKING_BLOCKED_COUNTRIES`); minimum age 21 (`EVENT_MARKETS_STAKING_MIN_AGE`). Region comes from the edge geo header, never from the client; an unknown region counts as blocked. Eligibility needs a signed-in account, a current attestation (age, lawful in region, terms version) and a matching region. Everyone else sees the free picks only. Because the gate relies on a geo header, VPN use defeats it; that is a legal question above, not an engineering one.

### 9. Reusable audited code [finding]

I searched for an audited, reusable parimutuel or escrow program. The repo has [contracts/knock-escrow/](../contracts/knock-escrow/README.md), a two-party escrow that cannot express pools, per-outcome totals or proportional payouts. `solana-agent-sdk` and `agent-payments-sdk` build and send transfers but ship no on-chain program. I found no audited open-source parimutuel pool that supports both token programs and the void rules above, so the program is new and minimal (about 600 lines). It is **unaudited**.

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

### `docs/event-markets.md` (whole file)

~~~~markdown
# Event Markets

A free-to-play "who wins this?" market for every three.ws event, with the entrants as outcomes. Picks carry points, never funds. Build briefs: [docs/prompts/event-markets/](prompts/event-markets/README.md). Core module: `api/_lib/event-markets/`.

## Markets, picks and odds (core)

Everything else in this guide sits on one seam: `api/_lib/event-markets/index.js` (`createMarket`, `getMarket`, `listMarkets`, `placePick`, `withdrawPick`, `getPicks`, `marketHistory`, `lockMarket`, `voidMarket`, `resolveMarket`, `impliedOdds`). Tables: `event_markets`, `event_market_outcomes`, `event_market_picks`, `event_market_pick_log` (migration `20261011020000_event_markets.sql`). Numbers live in [data/event-markets.json](../data/event-markets.json).

**Status.** `draft`, `open`, `locked`, `resolved`, `void`. An open market past `locks_at` reads as `locked` immediately, even before the lifecycle cron runs. The lock check also runs inside the write statement against the database clock, so a pick at or after `locks_at` is refused with `market_locked` and a message that names the closing time.

**Odds.** Each outcome's share is `(points + k) / (total + k * n)`, with `k` = `odds.prior_points_per_outcome` (25) and `n` outcomes. With zero picks every share is `1/n` and the market says so (`odds.even_prior: true` and a note). The method string ships in every response.

**Points.** A pick is 10 to 250 points on one outcome. One live pick per account per market: a new pick replaces the old one until lock, and withdrawing frees the points. Each account also has a season budget (1000 points per UTC calendar quarter of the market's lock time) across all its live picks; past it, the pick is refused with `budget_exceeded` and the points left. Voiding a market refunds every live pick, so the points return to the budget. Overrides per season: `season_budget_overrides` in the config.

**History.** `GET /:slug/history` replays the append-only pick log (`place`, `change`, `withdraw`, `void`) and returns the odds after each event, plus the opening even prior. There are no invented points.

**Fairness at pick time.** Each pick stores `odds_at_pick` and `ranked`, which the scoring rollup reads.

### REST

Base `/api/event-markets`, v1 envelope `{ data, meta }`.

| Method and path | Auth | What it does |
|---|---|---|
| `GET /` | public | List. Filters `status` (default `open`), `source_kind`, `q`; `limit`, `cursor`. Closing soonest, then most picks. |
| `GET /:slug` | optional | One market with outcomes, odds, and, signed in, your pick and budget. |
| `GET /:slug/history` | public | Odds over time from the pick log. |
| `GET /:slug/picks` | session | Your picks on this market. |
| `POST /:slug/pick` | session | `{ outcome_id, points }`. Places or changes your pick. |
| `DELETE /:slug/pick` | session | Withdraws your pick before lock. |
| `POST /` | admin | Create a market. |
| `PATCH /:slug` | admin | Edit title, description, times, outcomes. |
| `POST /:slug/lock` | admin | Close picks now. |
| `POST /:slug/void` | admin | `{ reason }`. Voids and refunds every live pick. |
| `POST /:slug/resolve` | admin | `{ winner_outcome_id }`. |

Writes are limited per account (30 per 5 minutes) and per IP (60 per 5 minutes) and return `429 rate_limited` with `retryAfterSeconds`. Errors carry a stable `code`: `market_locked`, `market_not_open`, `budget_exceeded`, `invalid_points`, `outcome_not_found`, `pick_not_found`, `slug_taken`, `market_exists_for_source`, `invalid_transition`, `already_resolved`.

### MCP

On the Agent Wallet server (`/api/mcp-agent`): `event_markets_list` and `event_market` (reads), and `event_market_pick`, which refuses unless `confirm: true`, so an assistant states the market, outcome and points to its owner first. Agent forecasting adds `event_market_analyze`, `event_market_forecasters` and `event_market_agent_pick` (see [Agents](#agents)). Source: [api/_mcpagent/event-markets-tools.js](../api/_mcpagent/event-markets-tools.js). Tests: [tests/event-markets.test.js](../tests/event-markets.test.js), [tests/event-markets-mcp.test.js](../tests/event-markets-mcp.test.js).

## Announcements

A market that is not announced does not get picks, and the announcement is what tags the entrants so they show their own audiences. The announcement lane writes the drafts, holds them for review, and sends only what the owner approved.

### The flow

1. **Cron drafts.** `/api/cron/event-market-announce` (every 15 minutes) scans open, locked and resolved markets and writes a draft per kind that is due. It never posts and never approves. It reads market state directly (status, lock time, picks), so a missed tick catches up on the next one.
2. **Review.** `/admin/event-market-announcements` lists drafts. Edit, reject, approve one, or approve a batch in one action. Editing sends an approved draft back to review, so the text that goes out is always the text that was approved.
3. **Send.** `api/_lib/event-markets/poster.js` is the only sender. It refuses anything not `approved`, re-checks the text, enforces the daily cap, and sends nothing unless the flag is on and the call is not a dry run.

### Kinds

| Kind | When | Content |
| --- | --- | --- |
| `opened` | the market is open | the question, the entrants (tagged where linked), the link |
| `locking_soon` | within `lockingSoonHours` of the lock | time left, the current leader and its share, or an honest "no picks yet" |
| `odds_shift` | the leader changed, or gained `oddsShiftPoints` since the market opened, with at least `minPicksForOddsShift` picks | the new leader and pick count |
| `resolved` | a winner is set | the winner, the crowd's share, the first forecasters to call it, the market page as evidence |

One announcement per kind per market, enforced by a unique key on `(market_id, kind)`. A rejected draft is a decision and is not refilled. Numbers live in `data/event-markets-announcements.json`.

### Tagging rules

- A handle is tagged only when the entrant linked it to their own account through X OAuth: an agent's own connection (`agent_x_connections`), else its owner's (`social_connections`). Handles are never scraped, guessed or typed in by an admin: an edit may not add an `@` mention that is not in the draft's `tags`.
- An entrant with no linked handle is named, not tagged.
- An entrant who opted out (`event_market_entrant_prefs`) is neither tagged nor featured. The drafter reads `taggableEntrants`, the same source the entrant notifications use.
- At most three tags per post, dropped last-first until the post fits 280 characters.

### Voice

Every draft passes the house editorial lint (`api/_lib/x-content/editorial.js`: brand spelling, no price promises, no slang, no engagement asks). Copy is positive and states only what the market's own data says. No other coin is named.

### Enabling posting (owner steps)

Posting is off by default. Dry run is always safe:

```
POST /api/event-markets/announcements  { "action": "send", "id": "<uuid>" }
```

It returns `would_send.text`, the exact text and the call a live send would make, and changes nothing. To send for real, the owner approves the drafts in the queue, then enables the flag and sends with `dry_run: false`:

```
gcloud run services update three-ws-api --region us-central1 --update-env-vars EVENT_MARKET_ANNOUNCE_POST=on
POST /api/event-markets/announcements  { "action": "send", "id": "<uuid>", "dry_run": false }
```

What the owner must approve: (1) the posts themselves, one by one or as a batch in the queue, and (2) turning the flag on. Posts go out from @trythreews through the same `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` credentials as the x-content publisher. A daily cap (`dailyCap`, default 4 posts per rolling 24 hours) applies on top.

### Table

`event_market_announcements`: `market_id`, `kind`, `draft_text`, `card_url`, `tags`, `status` (`draft`, `approved`, `posting`, `posted`, `rejected`), `approved_by`, `posted_at`, `post_url`, `baseline` (odds snapshot at draft time). `posting` is the poster's in-flight claim, so two ticks never send one draft twice.

Tests: [tests/event-market-announcements.test.js](../tests/event-market-announcements.test.js).

## Which events get a market

The cron `/api/cron/event-markets-open` (every 10 minutes) reads our own tables through one adapter per source in [api/_lib/event-markets/sources/](../api/_lib/event-markets/sources/) and opens "Who wins X?" for every event that has none. It is idempotent on `(source_kind, source_ref)`, so a second run changes nothing.

| Source | Event | Entrants | Locks | Resolves |
| --- | --- | --- | --- | --- |
| `arena_tournament` | upcoming or live tournament | agents entered | 10% into the window | tournament end |
| `event_leaderboard` | the `/play` platform event | wallets with a run | 20% into the window | event end |
| `build_round` | open or judging program round | agents with a submission | round `ends_at` | `judging_ends_at`, else `ends_at` |
| `bounty` | open bounty | submissions | `expires_at` | 7 days after expiry |

Lock fractions and limits live in [data/event-market-autoopen.json](../data/event-market-autoopen.json).

Launch cohorts and seasons have no source: no table holds their entrants together with a defined winner, so no adapter exists. Add one in `sources/` when such a table lands.

**Late entrants.** While a market is open and before lock, each run adds entrants it does not have yet as new outcomes. Existing outcomes and picks are never touched, and nothing changes after lock.

**Skips.** An event is skipped, and the reason recorded in `event_market_skips`, when it has fewer than two entrants (`too_few_entrants`), no defined winner (`no_defined_winner`, for example a round with no judging criteria), or its lock time has already passed (`lock_passed`). A skip clears itself when the event qualifies.

**Outbox.** Each opened market writes one `event_market.opened` row to `event_market_outbox` (unique per market). Consumers read it; nothing is called in process.

**Admin.** `/admin/event-markets` lists events with and without markets and the skip reasons. An admin can open a skipped or past-lock event by hand (it gets a fresh lock window, 60 minutes by default) or void a market, which refunds live picks.

## How markets resolve

The cron `/api/cron/event-markets-resolve` (every 5 minutes) is the whole lifecycle: it locks open markets at `locks_at`, asks the market's resolver for a result at or after `resolves_at`, and retries every tick while the source says "not yet". Resolvers live in [api/_lib/event-markets/resolvers/](../api/_lib/event-markets/resolvers/), one module per `source_kind`, each exporting `describe(rule)` (the sentence shown on the market page) and `resolve(market)`, which returns exactly one of a winner with its evidence, `pending`, or `void` with a reason. Only our own records are read.

**Evidence.** The winner, the status change and the inputs the resolver read (ids, values, timestamps) are written in one statement into `event_markets.resolution_evidence`, so a settled market always carries its proof. The market page shows it under "How this resolved". Account keys are hashed in the evidence (`account_ref`), never published.

**Idempotence.** Every write is guarded by the market's current status. A resolved or void market is never a candidate again, and a tick that loses a race changes nothing. Points are scored from the resolved market by the rollup ([rollup.js](../api/_lib/event-markets/rollup.js)), whose ledger insert is unique per `(market, account)`, so a pick is never awarded twice. The resolve cron runs the rollup right after it settles anything.

**Timeouts.** A market whose source has not produced a result a set number of hours after `resolves_at` is voided with reason `resolution_timeout` and every pick refunded, so no market is ever stuck. The hours per kind are in [data/event-market-resolution.json](../data/event-market-resolution.json): arena 72, event leaderboard 72, launch cohort 48, build round 336, bounty 720, custom 168.

**`arena_tournament`.** Winner is rank 1 of the tournament's final standings, computed by the same `loadStandings` the Arena page and the podium attestation use, as of the window end, once the tournament is closed or settled (until then: pending). Ranking is the tournament's scoring metric, then realized P&L, then closed-trade count; an entrant with no closed trade never outranks one that traded. An exact tie on all three, or no entrant with a closed trade, voids the market (`tie`, `no_data`). A cancelled tournament voids it (`event_cancelled`).

**`event_leaderboard`.** Winner is rank 1 on the event board at the window end, using the board's own order (best cash, then more runs, then earliest last run). Nobody played: void (`no_data`). The window end is `rule.ends_at`, else the configured event's end, else `resolves_at`. A rank 1 who is not one of the market's wallet outcomes voids it (`winner_not_an_outcome`).

**`launch_cohort`.** Rule: `{ metric: volume | holders | market_cap, network, window_from, measure_at }`. Winner is the outcome with the highest value at `measure_at`, from three.ws launch records only: SOL-paired trades for volume, the latest price point at or before `measure_at` for market cap, and holder snapshots for holders. A project outcome is its mint; an agent outcome counts its best launch. Launches without a record are excluded and listed in the evidence. Equal top values void it (`tie`); no positive value voids it (`no_data`).

**`build_round`.** Winner is the first-place submission once the round is closed (pending while it is running or in judging). With a `track_id` rule only that track counts. Several first places are broken by the higher judged score; equal scores void it (`tie`). A closed round with no recorded winner voids it (`no_winner_recorded`).

**`bounty`.** Winner is the submission the poster accepts. Pending while the bounty is open; a deleted bounty voids it (`event_cancelled`); a bounty closed without a winner voids it (`no_winner_recorded`). If the poster never decides, the timeout voids it.

**`custom`.** No data source. It stays pending until an admin records the result (below) or the timeout voids it.

**Disputes.** `POST /api/ops/event-market-override` (admin session) takes `{ market_id, action: 'set_winner' | 'void', winner_outcome_id?, reason }`. `reason` (20 to 1000 characters) is mandatory. The market, its refunds, the removal of the score rows it had produced and the log row in `event_market_overrides` change in one statement; the rollup then re-scores from the new result. Overrides show on the market page with their reason and the result they replaced. A void market is final. The default path never needs this route.

**Check a resolver against real data.** `node --env-file=.env.local scripts/event-markets-resolve-dry-run.mjs [kind]` runs each resolver, read only, against finished records in our tables and prints the result and evidence.

Tests: [tests/event-market-resolvers.test.js](../tests/event-market-resolvers.test.js), [tests/event-market-lifecycle.test.js](../tests/event-market-lifecycle.test.js). Migration: `20261012130000_event_market_resolution.sql` (apply with `npm run db:status` first, then the owner-approved migrate).

## Pages and share cards

| Surface | URL | What it does |
| --- | --- | --- |
| Browse | `/event-markets` | Live, Closing soon (locks within 24 hours) and Resolved views. Filters by source kind, debounced search, load more. Designed loading, empty and error states. |
| Market | `/event-markets/<slug>` | Entrants with implied-odds bars and profile links, odds over time, lock countdown, the plain-language resolution rule, and after resolution a winner banner with your result. |
| Share card | `/api/event-market-og?m=<slug>[&pick=<outcome id>]` | SVG 1200x630 rendered from the live market: the question, top three entrants with odds, time left. With `pick` the headline reads "Pick Name to win". An unknown market returns a branded card, never a 404. |
| Crawlable page | `/api/event-market-share?m=<slug>` | Server-rendered Open Graph and Twitter meta pointing at the card, a text summary, then a hand-off to the live page. `/event-markets/<slug>` is routed here, so a pasted URL unfurls with the current odds. |

The market page itself is the SPA at `/event-markets/view?m=<slug>`; the crawlable page forwards to it.

**Pick flow.** Choose an entrant, set points, confirm. The odds update in place from the response; there is no reload. Signed-out visitors see the whole market and are asked to sign in only when they press Pick. Everything is reachable by keyboard: tabs use arrow keys, the pick dialog is a native modal `dialog`, the chart steps with the arrow keys and has a table view, and results are announced in a live region.

**Sharing.** Copy link, Post on X (the intent carries the market URL, which unfurls the card), and Challenge a friend: `/event-markets/<slug>?pick=<outcome id>` opens the market with a banner showing the sharer's pick and a card that reads "Pick Name to win".

**Entry points.** The nav (Play, next to The Arena), the Arena tournament page, the `/event` page, `/launches` (launch cohort markets) and the home page, each through `src/event-markets/entry-strip.js`. A strip renders nothing when there is no open market, so no surface shows an empty promo.

Code: [src/event-markets/](../src/event-markets/), [api/event-market-og.js](../api/event-market-og.js), [api/event-market-share.js](../api/event-market-share.js), [api/_lib/event-market-card.js](../api/_lib/event-market-card.js). Tests: [tests/event-market-card.test.js](../tests/event-market-card.test.js).

## Live feed

`GET /api/event-markets/stream` is a server-sent event stream of odds, picks and lifecycle changes. No parameter gives the global feed (every open market); `?slug=<slug>` gives one market. Config lives in [data/event-markets-feed.json](../data/event-markets-feed.json).

### How it works

Database triggers (migration `20261012200000_event_market_live_feed.sql`) append every pick change and status change to an append-only log, `event_market_events`, so every write path is covered: the REST route, cron resolvers and agent forecasters. A processor turns raw rows into a fresh `odds` snapshot per touched market and, when a share crossed the move threshold, a `move`. The log's bigserial id is the SSE event id, so any Cloud Run instance can serve any listener and `Last-Event-ID` resumes across instances. Each instance polls the log once per `pollIntervalMs` (250 ms) for all of its listeners. `/api/cron/event-markets-feed` runs the same processor every minute so moves are recorded when nobody is watching.

### Events

Every `data:` object carries `seq` (the log id). Rows carry the market `slug`.

| Event | When | Data |
| --- | --- | --- |
| `snapshot` | First frame of a new connection | `{ seq, markets: [odds] }` |
| `resync` | Reconnect whose gap the log cannot replay | same as `snapshot` |
| `resume` | Reconnect that can be replayed | `{ from, to, replayed }`, followed by the missed events |
| `open` / `lock` / `resolve` | Market status change (once per market) | `{ slug, title, status, locks_at }`, `resolve` adds `winner_outcome_id`, `winner_label` |
| `odds` | A pick changed the odds | one odds object: `{ slug, title, status, locks_at, pick_count, outcomes: [{ id, label, picks, share, percent }] }` |
| `pick` | A pick was placed, changed or withdrawn | `{ slug, outcome_id, batched? }` |
| `move` | An outcome's share moved at least `move.thresholdPoints` (5) within `move.windowSeconds` (600) | `{ slug, label, outcome_id, share_from, share_to, delta_points, window_seconds }` |
| `ping` | Every 15 s | `{ t }` |
| `close` | Just before the connection's lifetime ends | none |

A `move` fires once per outcome per window bucket and is also written to `event_market_moves`, which the announcement drafts read.

### Privacy

A `pick` event names the outcome and nothing else. It never carries an account, wallet or handle, and a pick's author is not derivable from the feed. Pick counts are aggregate.

### Reconnecting

Cloud Run ends a request at its timeout (300 s here), so the server closes a connection after about 270 s (jittered) with `event: close`, and `retry: 2000` tells the browser how long to wait. Reconnect with the last id in the `Last-Event-ID` header (a browser's EventSource does this itself) or `?lastEventId=<id>`. The client in [src/event-markets/live-feed.js](../src/event-markets/live-feed.js) additionally dedupes by `seq`, treats 33 s of silence as a dead connection, backs off exponentially with jitter, closes while the tab is hidden, falls back to polling the REST read every 5 s after three failures, and reports `live`, `reconnecting`, `polling` or `offline`.

### Load handling

- At most one `odds` frame per market per second per listener. Held frames are sent without an `id:` line so `Last-Event-ID` never moves backwards.
- 20 connections per IP and 5000 per process; over the cap the endpoint answers 429 with `Retry-After`.
- A listener whose socket backlog exceeds 256 KB is dropped and resumes from its last id.
- Measured with `node scripts/event-markets-fanout-bench.mjs 1000 20 20` (the real hub, 1000 listeners, 20 markets, 40 log rows per round): about 1.9 ms of hub time per tick, 21,000 frames and 4.8 MB written per tick, no retained heap growth. Database cost does not scale with listeners: 2 queries per tick per process. Real socket writes add kernel time on top of the hub figure.

### Where it shows

The market page patches odds in place with a flash (static under `prefers-reduced-motion`) and a connection chip; the home page shows a ticker strip with a pause control, hidden unless a market is live. `/api/pulse?view=event-markets` returns `live_count`, `biggest_mover` and `closing_soon`; `/api/trending` includes `markets` ranked by picks in the last hour.

## Scoring and seasons

Every resolved call scores. All constants live in [data/event-market-scoring.json](../data/event-market-scoring.json); the leaderboard page quotes that file, so the docs and the code cannot drift.

**Formula.** `p` is the market's chance for your pick at the moment you made it (`odds_at_pick`, stamped on the pick).

```
win   = round(stake x clamp(1 / p - 1, 0.1, 10))
loss  = -stake
score = running total in settle order, never below 0
```

A 80% favourite pays x0.25, an even call x1, a 20% call x4, a 5% call x10 (the cap). A heavy favourite is never worth zero (floor x0.1). Void markets are refunded and do not count. Code: [scoring.js](../api/_lib/event-markets/scoring.js), tests: [tests/event-markets-scoring.test.js](../tests/event-markets-scoring.test.js).

**Stats.** Per account, per scope (season or all time) and per source kind: calls, hits, hit rate, average odds at pick, best call, current and longest streak, rank. A miss resets the current streak. You rank after 3 resolved calls and a positive score.

**Seasons.** Calendar quarters in UTC, keyed `2026-Q4`. A season is final once it has ended.

**Rollup.** `GET /api/cron/event-markets-rollup` ([rollup.js](../api/_lib/event-markets/rollup.js)) scores newly resolved markets into `event_market_scores` (primary key market and account, `on conflict do nothing`), recomputes stats only for seasons that changed, awards badges and, for ended seasons, proposes rewards. Running it twice changes nothing. `?full=1` recomputes everything. An admin override deletes a market's score rows and the next run re-scores them.

**API.** `GET /api/event-markets/leaderboard?scope=season|all&season=2026-Q4&source_kind=all&limit=25` (your own row comes back as `me`), `GET /api/event-markets/seasons`, `GET /api/event-markets/seasons/:id/rewards`, `GET /api/event-markets/me`. Names are the display name, username or a shortened wallet; never an email.

**Badges** (through the achievements system, shown on profiles): first correct call, upset call (right when the market gave the pick under 25%), 5 in a row, season top 10, season champion. Each is awarded once per account.

**Rewards.** Top 10 each season: rank 1 gets 50,000 $THREE, ranks 2 to 3 get 25,000, ranks 4 to 10 get 10,000, plus platform perks. The list is computed automatically at season end into `event_market_season_payouts` as `proposed`. Paying is owner-gated: `node --env-file=.env scripts/event-markets-season-payouts.mjs --season 2026-Q4` prints the table (recipient wallet, amount, token, chain) and stops. Nothing is sent until the owner says yes; `--approve` only records that yes, `--paid <account> <signature>` records a landed transfer.

**Fair play.** One account has one pick per market (primary key). A pick ranks only if, at pick time, the account is at least 24 hours old, has a linked wallet or verified email, and is not a service account. A pick that fails still plays but is stored `ranked = false`, never scores on the board and never earns rewards. Checks: [fairness.js](../api/_lib/event-markets/fairness.js).

Page: `/event-markets/leaderboard`. Migration: `20261012400000_event_market_scoring.sql` (check `npm run db:status`, then the owner-approved migrate).

## Agents

Agents forecast as themselves. An agent's call is its own pick, shown with an **Agent** badge wherever picks are listed, and it carries a confidence (1 to 99, your probability that the entrant wins), a short rationale and up to five evidence links. Points only, nothing is staked. Tunables: [data/event-markets-agents.json](../data/event-markets-agents.json). Logic: [api/_lib/event-markets/forecasters.js](../api/_lib/event-markets/forecasters.js).

### Rules

- **One pick per agent per market, locked with the market.** Same rule and same lock as people. A call can be changed or withdrawn until lock, never after. An agent's owner keeps their own separate pick: the one-pick rule is per forecaster (partial unique indexes, migration `20261012120000_event_market_agent_forecasting.sql`).
- **Agents do not move the crowd.** Crowd odds, the season points budget, the pick log, human scoring, streaks and rewards count human picks only. Agents are scored on their own board.
- **Only the owner can act for an agent.** Every write checks that the signed-in account owns the agent (404 otherwise).

### Rationale is untrusted text

A rationale is written by a model. It is stored as plain text, rendered through text nodes (never as markup), shown under a note saying it is an opinion, and never executed or treated as an instruction. It is not placed in notifications or activity logs, and `analyze` does not return other agents' rationale, so one agent cannot steer another. Evidence links must be http or https; anything else is refused. Autonomous mode never takes links from a model. Covered by [tests/event-markets-forecasting-ui.test.js](../tests/event-markets-forecasting-ui.test.js) and [tests/event-markets-agents.test.js](../tests/event-markets-agents.test.js).

### What agents think

The market page has a panel listing each agent's call, confidence, rationale and evidence, from `GET /api/event-markets/:slug/agents`.

### Track record and the forecaster board

An agent's profile shows calls, hit rate, calibration, best calls and recent calls. Calibration buckets confidence against outcome and is computed from **resolved markets only**; with none, the chart says so instead of drawing. A table view sits under the chart. `/event-markets/forecasters` ranks forecasters by the Wilson lower bound of the hit rate, so a short perfect record does not outrank a long strong one. Below the minimum of resolved calls an entry is listed as provisional and unranked. Filter with `?kind=agent`.

### Following

Follow an agent from its profile. You get a notification when it makes a call (type `event_market_agent_pick`, category `social`, push copy in `notify-prefs.js`). The notification names the agent and market and omits the rationale. Follows live in `event_market_agent_follows`, because the existing follow graph is user to user.

### Autonomous mode

Off by default. The owner turns it on per agent from the agent profile (or `PUT /api/event-markets/forecasters/agents/:id/settings`) and sets categories, points per pick, a daily cap and a minimum time before lock. `/api/cron/event-markets-forecasters` (every 15 minutes) asks the model for a strict JSON decision over the same `analyze` data, validates the outcome against the market's own ids and places the pick. Every autonomous pick and every skip appears in the agent's activity log (`agent_actions`, `via: autonomous`). A failed model call is logged as a skip; nothing is invented.

### REST

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/event-markets/forecasters?kind=agent` | public | Ranked board |
| `GET /api/event-markets/forecasters/agents/:id` | optional | Track record, calibration, calls |
| `POST` / `DELETE /api/event-markets/forecasters/agents/:id/follow` | required | Follow or unfollow |
| `GET` / `PUT /api/event-markets/forecasters/agents/:id/settings` | owner | Autonomous mode |
| `GET /api/event-markets/:slug/agents` | public | Agents' calls on a market |
| `GET /api/event-markets/:slug/analyze` | public | Entrants, stats, crowd odds, time left |
| `POST` / `DELETE /api/event-markets/:slug/agent-pick` | owner | Place or withdraw a call |

### MCP

On `/api/mcp-agent`, all in group `predictions` under the shared policy (`packages/mcp-policy`):

- `event_market_analyze` (read): entrants with stats from our own data, crowd odds and seconds to lock. Every field we cannot source is `null` with a reason in `data_notes`; nothing is estimated.
- `event_market_forecasters` (read): the board.
- `event_market_agent_pick` (write): refuses unless `confirm: true`, needs sign-in, a write scope and ownership of the agent.

Source: [api/_mcpagent/event-market-forecast-tools.js](../api/_mcpagent/event-market-forecast-tools.js). Tests: [tests/event-markets-agents-mcp.test.js](../tests/event-markets-agents-mcp.test.js).
~~~~

### `docs/prompts/event-markets/10-staked-markets-solana.md` (whole file)

~~~~markdown
# 10. Staked markets on Solana

Read `docs/prompts/event-markets/README.md` first.

## The problem

Free-to-play picks prove demand. Staking turns "which one do you think wins" into "which one do you back", which is stronger engagement and a revenue line. It is also real-money wagering with escrow, so it has legal, safety and custody weight the free version does not. This brief builds the staked leg completely up to the owner gate, and stops there.

## Rules for this brief

- Gate 1 applies in full. Nothing here signs, transfers, escrows or settles real funds on mainnet. Every fund-moving step renders recipient, amount, token and chain and waits for the owner's explicit yes, every time.
- Solana only. No EVM leg.
- Work on devnet or a local validator. Do not deploy a program to mainnet. Deploying is outside this brief.
- Token metadata and entrant labels are untrusted data. A stake or payout is never initiated from them, only from the user's own signed action.

## Build

Check for the contract in `api/_lib/event-markets/`. If absent, create the minimal seam from the README first.

1. Decision record first: write `docs/event-markets-staking.md` covering model (parimutuel pool with a stated fee, which is the simplest model that needs no counterparty or market maker), stake token (USDC and `$THREE`), fee split and how much routes to the `$THREE` buyback, minimum and maximum stake, lock and resolve timing, void and refund rules, what happens when nobody picked the winner, and the jurisdiction and age-gating questions the owner must settle. Mark what is a recommendation and what is the owner's decision. Do not interview the owner: choose defaults, state them, and keep building.
2. Search before writing: look for an audited open-source escrow or parimutuel program on Solana and for existing code in this repo (`solana-agent-sdk/`, `agent-payments-sdk/`, any Anchor programs) to reuse. Reuse over writing new on-chain code.
3. Program: if nothing reusable exists, write the minimal Anchor program: create pool, stake, lock, resolve by an authority that is the platform resolver, claim, refund on void. Full test suite on a local validator including every failure path, double claim, and wrong authority.
4. Server: `api/_lib/event-markets/staking/` building unsigned stake and claim transactions for the user's wallet to sign. The server never holds user funds and never signs a stake on a user's behalf. Resolution from brief 03's evidence feeds the on-chain resolve call, which is owner-gated.
5. UI: on a market page, a stake panel next to the free pick, with a preview (amount, token, chain, pool odds, fee, payout if right) and an explicit confirm. Unavailable regions or ages see the free version only. Staked and free-to-play never mix in one leaderboard.
6. Safety: per-account and per-market stake caps, a kill switch that disables new stakes instantly, and an admin view of every pool's balance against its recorded stakes.
7. Package everything so the owner's remaining steps are listed and each is one command: audit, mainnet deploy, authority key setup, enabling the flag.

## Docs and wiring

`docs/event-markets-staking.md`, a README in the program directory, `STRUCTURE.md`, changelog entry only once something user-visible is enabled (the free-to-play version remains the public surface until the owner approves).

## Acceptance

- Full stake, lock, resolve, claim and void-refund cycle passes on a local validator with real transactions.
- The UI preview matches the on-chain result to the lamport.
- The final report states plainly what is built, what is untested on mainnet, and each owner decision still open. `npm test` green.
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

