# A new "paid-intel" sniper arm that buys its entry signals over x402 and logs the payment signature in every decision

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/976-plan-x402-paid-intel-sniper-arm.md`.

**Priority:** Gated, the last step needs an owner action or outside party (score 52 of 100 inside the tier). **Area:** x402. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The platform sells signals over x402 and runs autonomous Solana sniper arms, but the two have never been joined: no arm buys the platform's own paid intelligence before it trades. A "paid-intel" arm proves agent-to-agent paid data flows produce trading decisions, gives every ledger entry a verifiable x402 transaction signature, and is the only honest demonstration of the "agents pay agents" thesis on the home chain (Solana). The owner brief put it on hold pending a green light, and demands a strictly additive build: existing arms, wallets, budgets and shared execution paths must not change behavior. Funding the arm's wallet and every paid signal call or trade are on-chain spend, so the order builds, tests and dry-verifies everything and stops at the funding request.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Sniper worker: `workers/agent-sniper/index.js` dispatches entry by `strat.decision_mode` (lines around 181 and 262: `'rules'` default or `'llm'`). `decision_mode` is validated by `z.enum(['rules','llm'])` in `api/sniper/strategy.js:124` and stored by `api/_lib/migrations/20260719120000_sniper_llm_experiments.sql`. LLM judging lives in `workers/agent-sniper/llm-judge.js`; the per-arm optimizer is `api/_lib/sniper-optimizer.js` (`mode = config.decision_mode`); experiments listing is `api/sniper/experiments.js`.
- Execution stack (firewall simulation, exit ladder, journal, ledger) is shared: `workers/agent-sniper/{executor,exit-logic,positions,journal}.js`; docs `docs/agent-sniper.md`.
- Paid signal endpoints exist: `api/x402/pump-launch.js` (cataloged in `api/wk.js` as `/api/x402/pump-launch`), `api/x402/market-anomalies.js`, `api/x402/market-trending.js`, `api/x402/pump-agent-audit.js`. The Solana payer primitive is `payX402()` and `bootstrapSolanaContext()` in `api/_lib/x402/pay.js`.
- No `paid_intel` decision mode, no arm that calls `payX402` before a trade, and no ledger field carrying an x402 signature for a decision (`grep -rn "paid_intel" workers api packages` returns nothing).
- The experiment blog the brief cites (three.ws/blog/autonomous-trading-experiment) reports the LLM cohort best net PnL at +0.0147 SOL with 52.3 percent average winner; the brief's graduation bar is to beat that per equal budget over 76 hours.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -rn "paid_intel\|paid-intel" workers api packages src docs --include=*.js --include=*.md --include=*.sql | head
sed -n 170,200p workers/agent-sniper/index.js
sed -n 1,60p api/_lib/x402/pay.js
grep -n "pump-launch\|market-anomalies\|market-trending" api/wk.js | head
npm run db:status          # read before any migration; db:migrate applies immediately
curl -s https://three.ws/api/sniper/experiments | head -c 600
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Design note in `docs/agent-sniper.md` (new section "Paid-intel arm"): entry rule, budgets, skip semantics, graduation benchmarks from the brief (net PnL above +0.0147 SOL per equal budget, zero firewall violations, zero premature-sell audit failures, 100 percent of ledger entries with a valid x402 signature), and the first 76 hour window.
2. Additive migration `api/_lib/migrations/<timestamp>_sniper_paid_intel.sql`: allow `decision_mode = 'paid_intel'` (check the column constraint first), add nullable `intel_spend_atomic` and `intel_signal_receipts jsonb` to the decision/journal record that already stores the LLM verdict. Idempotent (`IF NOT EXISTS`). Read `npm run db:status` before applying anything.
3. New module `workers/agent-sniper/paid-intel.js`: per cycle, for each candidate launch, buy signals through `payX402` from the arm's own wallet: recent-launch quality fields (`/api/x402/pump-launch`), volume anomaly (`/api/x402/market-anomalies`), trending score (`/api/x402/market-trending`). Entry requires agreement of at least two signals (launch quality passes AND positive-side anomaly) as a starting rule; the optimizer may tune thresholds within bounds. Record each payment's transaction signature and price in the reasoning ledger entry for the decision.
4. Skip semantics: if any purchase fails (endpoint down, wallet dry, 402 mismatch, spend cap reached), the arm skips that cycle and logs the reason. It must never fall back to the unpaid version of the same data.
5. Wire the mode in `workers/agent-sniper/index.js` as a new branch beside `llm` with zero change to the `rules` and `llm` paths (prove with the existing sniper tests unchanged and green), extend the `z.enum` in `api/sniper/strategy.js`, and make `api/_lib/sniper-optimizer.js` and `api/sniper/experiments.js` treat `paid_intel` as its own cohort label.
6. Budget and sizing: the smallest existing per-arm daily budget in the fleet, halved, and the fleet minimum position size; concurrency one. Read the values from the live strategy rows rather than hardcoding.
7. Tests: `tests/sniper-paid-intel.test.js` covering agreement rule truth table, skip-on-failed-payment (asserts no unpaid fetch is made), ledger entry carries a signature for every decision, budget cap, and that the `rules` and `llm` branches are untouched. Payment is injected at the module boundary in the test only; app code calls the real `payX402`.
8. Dry verification on devnet or against a throwaway test mint: run the decision loop with `payX402` pointed at the repo's devnet facilitator path if one exists (check `docs/x402-ring-economy.md`), otherwise run the full loop up to the first purchase and print the payment request that would be made. Do not spend mainnet funds in this task.
9. Prepare the funding request: new arm wallet address (created through the existing strategy/wallet creation path with spend caps and withdraw allowlist at creation), requested SOL and USDC amounts, daily budget, and the exact arm command. Present it in one table at the end.
10. Docs and changelog: `docs/agent-sniper.md`, a STRUCTURE.md row only if a new directory appears, `data/changelog.json` entry only when the arm goes live.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/sniper-paid-intel.test.js` passes and `npx vitest run tests/agent-sniper-*.test.js tests/sniper-*.test.js` still passes unchanged.
- [ ] `git diff --stat` shows no edits to `workers/agent-sniper/{executor,exit-logic,positions,journal}.js`, or each edit is justified as behavior-neutral in the report.
- [ ] `grep -rn "fetch(" workers/agent-sniper/paid-intel.js` shows no unpaid call to the three signal endpoints.
- [ ] Migration applies idempotently on a scratch database (run twice, second run no-op).
- [ ] The report ends with the funding table (wallet, SOL, USDC, daily budget) and the graduation benchmarks.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Brief says "hold until owner green-lights" | The standing instruction is to build everything and stop only at the spend gate; the arm is implemented but unfunded and not armed. |
| No devnet facilitator for dry runs | Test with the payment boundary injected, and print the would-be payment request; real settlement happens only after the funding yes. |
| Shared stack change seems unavoidable | Add a new module and a branch; if a shared edit remains, prove it behavior-neutral with the untouched existing tests and show the diff. |
| Signal endpoint price changed | Read the 402 challenge at call time; never hardcode prices. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Funding the new wallet (SOL and USDC), every real x402 signal purchase on mainnet, and every real trade are irreversible on-chain spend actions. Stop at the funding table (recipient, amount, token, chain) and ask for an explicit yes once, batched at the end of the session. Existing arms and wallets are not touched. The brief's own rule applies: no change to any other arm's behavior.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/976-plan-x402-paid-intel-sniper-arm.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `976-plan-x402-paid-intel-sniper-arm.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/agent-tasks/new-trading-arm-x402-signals.md` (whole file)

~~~~markdown
# Task: Build a NEW autonomous trading arm that consumes paid x402 signals (do not touch existing arms)

## Status: HOLD until the owner green-lights it in your chat. Read fully, then confirm scope with the owner before writing code.

## Context

three.ws runs an autonomous trading experiment: 11 agents, 8 actively trading strategies ("arms"), real Solana wallets, trading pump.fun launches. Public writeup and live results: https://three.ws/blog/autonomous-trading-experiment. Architecture facts from that page you must honor:

- Arms are modular entry logic plugged into an identical execution stack: shared safety rails, on-chain firewall (simulated buy+sell round trip before execution), exit ladder, per-arm position sizing, daily budgets, concurrency constraints.
- Every decision writes to a hash-chained reasoning ledger. All wallets and receipts are publicly auditable.
- Performance verdict so far: the LLM cohort won only 24% of trades but was net positive (+0.0147 SOL, average winner +52.3%); rules arms won 30% but net negative. Win rate is a vanity metric; net PnL and average-winner size are what count.
- A self-improving optimizer tunes parameters every 6 hours within hard bounds.

## The hard rule

Do NOT modify, retune, pause, or rewire ANY existing arm, their wallets, their budgets, or shared execution code paths in a way that changes existing behavior. You are ADDING one new arm. If a shared-stack change is unavoidable, it must be provably behavior-neutral for existing arms (show the diff and the reasoning in your report) and kept minimal.

## The new arm: "paid-intel"

Entry logic that buys its signals through the platform's own x402 rails with real USDC micro-payments before every decision. This is the point: proving paid agent-to-agent data flows produce trading decisions.

1. Signal sources: the existing paid endpoints already served by the platform, at minimum `Pump Launch Monitor: Recent Launches`, `Pump.fun Volume Anomaly Oracle`, and `Crypto Intel: Pump.fun Trending Score Feed` (find their handlers under `api/x402/`). Each cycle: pay, fetch, decide. Log the payment tx signature IN the reasoning ledger entry alongside the decision so every trade is traceable to the paid signals that caused it.
2. Entry rule (starting point, optimizer may tune within bounds): require agreement of at least two paid signals (e.g. launch appears in recent-launches with quality fields passing, AND anomaly oracle flags positive-side volume anomaly). The blog's lesson is that selective, high-conviction entries with big winners beat high-frequency small winners; bias the arm toward fewer, better entries.
3. Budget: smallest existing per-arm daily budget in the fleet, halved, for the first 76-hour window. Position sizing at the fleet minimum. This arm must be cheap to be wrong.
4. Benchmarks it must beat to graduate (measured over its first 76 hours, same grading as the blog): net PnL > +0.0147 SOL equivalent per equal budget (beat the current best cohort), zero firewall violations, zero premature-sell audit failures, and 100% of ledger entries carrying valid x402 tx signatures.
5. If x402 signal purchase fails (endpoint down, wallet dry), the arm SKIPS the cycle and logs why. It never falls back to fetching the same data unpaid; that would defeat the experiment.

## Spend gate

Funding a new wallet and every real trade are on-chain spend actions. Wire everything, then present the owner: new wallet address, requested SOL/USDC funding amounts, daily budget, and get an explicit yes before the first funding transfer. The arm's autonomous trading after funding follows the fleet's existing approval model.

## Constraints

- OWNER RULE, overrides everything: do not modify anything that is working today. This arm is strictly additive: new files, new wallet, new roster entry. Zero edits to existing arms or to shared execution code unless provably behavior-neutral, and even then minimal.
- Solana only. Real payments, real trades, no mocks anywhere.
- CLAUDE.md rules apply, including: never use em-dash or en-dash characters anywhere; changelog entry when the arm goes live; docs update (`docs/agent-sniper.md` or the blog data page, follow existing patterns).

## Done means

Arm implemented and wired into the fleet infrastructure but NOT funded/trading until the owner's explicit yes; dry verification that it produces decisions from real paid signals (payments settled, tx sigs in ledger); report includes the funding request table and the graduation benchmarks above.
~~~~

### `docs/agent-tasks/README.md` (whole file)

~~~~markdown
# Agent task prompts

Self-contained task briefs for Claude agents, written to be pasted (or referenced by path) into a fresh chat. Each file carries all context needed to start cold: verified diagnostic data with dates, the job, constraints, and an explicit definition of done. One agent per file; run them in separate chats so each stays focused.

| File | Task | Depends on |
|---|---|---|
| [fix-x402-502-bursts.md](fix-x402-502-bursts.md) | Root-cause the autonomous loop's Cloud Run 502 bursts and the flapping Redis cache | nothing |
| [fix-x402-caller-mismatches.md](fix-x402-caller-mismatches.md) | Fix deterministic 405/400/422/402 loop failures and the zero-value Ring Tick service | nothing |
| [fix-x402-wallet-health.md](fix-x402-wallet-health.md) | Ring wallet SOL floors, unconfigured wallets, USDC float rebalancing | nothing |
| [new-trading-arm-x402-signals.md](new-trading-arm-x402-signals.md) | NEW trading arm driven by paid x402 signals. On HOLD until owner green-light | 502 + caller fixes landed |

Ground rules baked into every brief: existing autonomous trading arms are untouchable, all payments and trades are real, on-chain spend needs an explicit owner yes, and CLAUDE.md applies in full.

When a task completes, delete its file or mark it done here so a later agent does not re-run it.
~~~~

