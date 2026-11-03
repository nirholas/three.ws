# x402 batch-settlement on Solana with a Postgres voucher store and a scheduled redemption worker

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/750-plan-x402-batch-settlement-durable-vouchers.md`.

**Priority:** P2, new capability with clear value (score 44 of 100 inside the tier). **Area:** x402. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

`upto` (shipped) escrows a cap per call and settles the measured amount, but each call still costs a deposit transaction plus a claim. For high-frequency, low-value routes (market data, per-token LLM calls, the x402 ring itself) the fee floor per call dominates the price. x402 `batch-settlement` lets a buyer fund one channel and pay many calls with off-chain vouchers that the seller redeems in bulk, cutting on-chain transactions per call to near zero. The `upto` doc records a finding: `@x402/svm` already ships `batch-settlement/{client,server,facilitator}`, so the missing pieces are three.ws-specific state and wiring. Without a durable voucher store, losing the process loses revenue, which is why it was deliberately deferred.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `@x402/svm` is `^2.28.0` in `package.json`; `upto` is wired through `api/_lib/x402-paid-endpoint.js` (`buildUptoOffer`, `uptoEnabled` from `api/_lib/x402/upto.js`) and tested in `tests/x402-upto.test.js` with `tests/helpers/upto-local-facilitator.js`.
- Nothing in `api/`, `src/`, `scripts/`, `tests/` or `packages/` implements batch settlement: `grep -rn "BatchOperationStore\|batch-settlement"` only hits a comment in `api/x402/tutor.js` ("The batch-settlement channel + cooperative ...").
- The finding in `docs/x402-upto.md` lists four needs: (1) a durable voucher store (the package exports only `MemoryBatchOperationStore`), (2) a redemption worker on a schedule inside the forced-close grace period (`BatchSvmScheme.createChannelManager(...)`), (3) lifecycle hooks wired into `paidEndpoint` (pre-settle, post-settle, abort/cancel), (4) an on-chain run that a local facilitator cannot stand in for.
- Existing cron pattern: entries in `vercel.json` `crons` (for example `/api/cron/x402-settlement-reconcile` every 2 minutes) are synced to Cloud Scheduler by `scripts/create-gcp-scheduler.mjs`; handlers live in `api/cron/`.
- Latest migration at review time: `api/_lib/migrations/20261024193900_fix_account_link_codes_collision.sql`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -rn "BatchOperationStore\|batch-settlement\|createChannelManager" api src scripts tests packages --include=*.js --include=*.mjs | head
node -e "const p=require('./node_modules/@x402/svm/package.json');console.log(p.version, Object.keys(p.exports||{}))"
ls node_modules/@x402/svm/dist/cjs 2>/dev/null | head -30
grep -n "batch" docs/x402-upto.md | head
ls api/_lib/migrations | tail -5
npm run db:status
```

Read the actual exported `BatchOperationStore` interface, `BatchSvmScheme`, and hook names from `node_modules/@x402/svm` before designing the table. Do not guess method names.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Migration: add `api/_lib/migrations/<timestamp>_x402_batch_settlement.sql` creating the voucher/channel tables the `BatchOperationStore` interface needs (channel id, payer, payee, mint, deposit, cumulative claimed, latest voucher, nonce, status, forced-close deadline, timestamps) with the unique and lookup indexes the interface relies on. Run `npm run db:status` first; `db:migrate` applies immediately with no dry run, so apply only your own new file and verify it appears in `schema_migrations`.
2. Implement `api/_lib/x402/batch-store.js`: a Postgres-backed class implementing the package's `BatchOperationStore` interface with compare-and-set semantics on the cumulative voucher amount (a stale or replayed voucher must never lower the stored amount). Add `tests/x402-batch-store.test.js` covering monotonic voucher updates, concurrent writers, restart durability (new instance, same rows), and idempotent redemption bookkeeping.
3. Wire the scheme into `paidEndpoint`: add a `batch` spec option beside `upto` in `api/_lib/x402-paid-endpoint.js`, advertised as an extra accept only when `X402_BATCH_ENABLED=true` (additive, `exact` accepts stay). Hook pre-settle (commit the voucher charge for steady-state requests), post-settle (finalize deposits and refunds), and abort/cancel (drop reservations). A handler that throws must settle nothing, as with `upto`. Reject `batch` combined with `streaming`.
4. Redemption worker: `api/cron/x402-batch-redeem.js` calling `BatchSvmScheme.createChannelManager(...)` to claim accumulated vouchers and distribute, authenticated like the other crons, idempotent per channel, and scheduled in `vercel.json` `crons` well inside the forced-close grace period (derive the interval from the configured grace; state the number). Alert through the existing monitor channel when a channel is within one interval of forced close with unredeemed vouchers.
5. Tests: extend `tests/helpers/upto-local-facilitator.js` pattern into `tests/helpers/batch-local-facilitator.js` and add `tests/x402-batch-settlement.test.js` driving `paidEndpoint()` with the real `@x402/svm` batch client and server schemes: 402 shape, deposit, N vouchered calls with one on-chain claim, partial refund on close, throwing handler, tampered voucher, replayed voucher, process-restart between voucher and redemption (rows survive, redemption still pays), buyer cap refusal.
6. Devnet proof: add `scripts/x402-batch-devnet-proof.mjs` that creates fresh devnet keypairs, funds them from the devnet faucet, opens a channel, makes 20 paid calls against a local server, redeems, and prints the transaction signatures and the on-chain vs off-chain call count. Run it and paste the output in the report. Use only devnet; the script must refuse a mainnet RPC URL.
7. Solana first: this order is Solana only. Do not add an EVM leg.
8. Docs: rewrite the "Batch settlement: finding" section of `docs/x402-upto.md` into a shipped-feature section (env flags, table, cron, hook semantics, limits) or create `docs/x402-batch-settlement.md` and link it from `docs/x402-endpoints.md`. Add a `STRUCTURE.md` row if a new directory landed, and a `data/changelog.json` entry; run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npm run db:status` shows the new migration applied and nothing else pending that you did not intend.
- [ ] `npx vitest run tests/x402-batch-store.test.js tests/x402-batch-settlement.test.js` passes, including the restart-durability case.
- [ ] `node scripts/x402-batch-devnet-proof.mjs` prints 20 successful paid calls and at most 3 on-chain transactions for the open, claim and distribute steps, with signatures verifiable on a devnet explorer; it exits non-zero if pointed at mainnet.
- [ ] With `X402_BATCH_ENABLED` unset, a route's 402 challenge is byte-identical to before (asserted in a test).
- [ ] `grep -n "x402-batch-redeem" vercel.json` shows the cron and `node scripts/create-gcp-scheduler.mjs --help` (or its dry-run flag) shows it would be created.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Devnet faucet rate-limited | Retry with backoff across the documented faucet endpoints and `solana airdrop` against a second RPC; smaller amounts suffice (a few cents of token units and 0.2 SOL). |
| `@x402/svm` 2.28 batch API differs from the doc finding | Trust the installed package source; update the doc finding to match and bump the dependency within the same major only if a fix requires it. |
| Template for hooks unclear | `upto` handling in `api/_lib/x402-paid-endpoint.js` (deposit before handler, cancel paths) is the documented template for the batch hooks. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Enabling `X402_BATCH_ENABLED` in production and any run against mainnet funds are owner-approved steps (spend gate). This order stops at a merged, tested, devnet-proven implementation with the flag off, and puts the exact mainnet command and expected cost in the report, batched into one message at the end.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/750-plan-x402-batch-settlement-durable-vouchers.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `750-plan-x402-batch-settlement-durable-vouchers.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/x402-upto.md` (section "Batch settlement: finding")

~~~~markdown
## Batch settlement: finding

`@x402/svm` 2.28.0 ships `batch-settlement/{client,server,facilitator}`, so this is not a missing-package gap. What `batch-settlement` needs that `upto` does not:

1. A **durable voucher store**. The package exports only `MemoryBatchOperationStore`; vouchers are worth nothing until claimed, so losing the process loses revenue. A Postgres-backed `BatchOperationStore` plus a migration is required.
2. A **redemption worker**. `BatchSvmScheme.createChannelManager(...)` claims accumulated vouchers and distributes what settles, and must run on a schedule well inside the forced-close grace period (a Cloud Scheduler cron).
3. **Wiring the scheme's lifecycle hooks into `paidEndpoint`**: pre-settle (commit voucher charges for steady-state requests), post-settle (finalize deposits and refunds), and the abort and cancel hooks that drop reservations.
4. An **on-chain run**. The claim and distribute transactions can only be proven against a funded cluster; the local facilitator in `tests/helpers/` cannot stand in for them.

`upto` ships first because it needs none of that state. The `upto` spec option and the deposit-before-handler and cancel paths in `x402-paid-endpoint.js` are the template for the batch hooks.
~~~~

### `docs/x402-upto.md` (section "Operating notes and limits")

~~~~markdown
## Operating notes and limits

- Channel state is in the facilitator's in-memory store. A crash between the deposit and the claim leaves the channel open until the payer's `withdrawDelay` (900 s) elapses; the payer can then withdraw the deposit. Nothing is lost, but the seller forfeits that call's revenue.
- The sponsor key doubles as voucher signer. Keep it out of any `X402_PAY_TO_*` wallet and rotate it like the other sponsor secrets.
- The offered `maxTimeoutSeconds` is 600; the facilitator refuses channels that live longer than 3600 s.
~~~~

### `docs/x402-upto.md` (section "Tests")

~~~~markdown
## Tests

`tests/x402-upto.test.js` drives `paidEndpoint()` end to end with the real `upto` client and server schemes. The facilitator (`tests/helpers/upto-local-facilitator.js`) is test-controlled and replaces only the chain with an in-memory ledger; the buyer's ed25519 signature over the open transaction and the server's ed25519 voucher are both verified for real. Cases: the 402 shape, partial settlement and refund, a throwing handler settling nothing, clamping above the cap, a tampered deposit, the buyer cap refusal, and the offer-receipt on the paid response.

A real on-chain check needs funded wallets and is run by the owner; the commands are in the work-order close-out.
~~~~

