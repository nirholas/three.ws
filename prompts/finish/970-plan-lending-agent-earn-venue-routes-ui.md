# Wire the Kamino lending venue into agent routes, lend tools and an Earn panel, up to the mainnet gate

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/970-plan-lending-agent-earn-venue-routes-ui.md`.

**Priority:** Gated, the last step needs an owner action or outside party (score 60 of 100 inside the tier). **Area:** lending. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Idle agent USDC earns nothing. The lending venue adapter and the math (health factor, earn-rule planner) are built, but `index.js` and `rpc.js` are missing, so there are no routes, no tools and no UI. Solana-native lending is a real yield story for agent treasuries. Everything up to the first mainnet deposit is agent-doable on simulation and devnet.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `api/_lib/lending/kamino.js` (330 lines: `VENUE_ID='kamino'`, `MAIN_MARKET`, `PROGRAM_ID`, lazy import of `@kamino-finance/klend-sdk`, `buildDeposit`/`buildWithdraw` returning unsigned instructions) and `math.js` (189 lines).
- Missing: `index.js` (venue registry), `rpc.js`, routes under `api/v1/agents/[id]/lending/`, tools `lend_*`, Earn UI, tests, docs.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
ls api/_lib/lending; wc -l api/_lib/lending/*.js
ls api/v1/agents/\[id\]; grep -rn "lending" api/_mcpagent packages/mcp-policy -l | head
ls tests | grep -i lend; npm ls @kamino-finance/klend-sdk 2>&1 | tail -2
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Tests first (`tests/lending-math.test.js`, `tests/lending-routes.test.js`): health factor and max-withdraw math against fixture reserves; the earn-rule planner never plans a withdraw that drops health factor below the floor; routes require auth and an agent the caller owns; deposits above the agent's spend cap are refused.
2. Create `index.js` (venue registry with `getVenue(id)`) and `rpc.js` (failover RPC reader using the project's Solana RPC helper).
3. Routes: `GET .../lending/positions`, `GET .../lending/markets`, `POST .../lending/deposit`, `POST .../lending/withdraw`, `PUT .../lending/earn-rule`. Deposit and withdraw return a simulated transaction preview (`simulateTransaction`) and require `confirm: true` plus the existing financial-tier guard before signing.
4. Tools `lend_positions`, `lend_deposit`, `lend_withdraw` in `api/_mcpagent/`, financial tier in `packages/mcp-policy/src/table.js`.
5. Earn panel on `pages/agent-wallet.html`: positions, APY, health factor, rule editor. States: skeleton, empty ("No lending positions. Set an earn rule to put idle USDC to work."), error with retry, hover/focus/active, mobile.
6. Devnet or simulation proof: build and simulate a deposit transaction against mainnet state without sending, print compute units and expected cTokens.
7. Docs `docs/agent-lending.md`, changelog.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/lending-*.test.js` passes.
- [ ] `POST .../lending/deposit` without `confirm` returns the preview only; simulation succeeds against current mainnet state.
- [ ] Earn panel verified in a browser in all states.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Kamino SDK heavy import | Keep it lazy as `kamino.js` does; load in the route handler only. |
| No funded position to read | Read a public reserve for market data; positions show the empty state. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

- Any real mainnet deposit or withdraw: render recipient (market program), amount, token and chain in a confirmation table and stop for the owner's explicit yes, every time. Tests and verification only simulate.
- The diff names another crypto project (Kamino); the commit needs owner approval before `git commit`. All asks batched into one message at the end.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/970-plan-lending-agent-earn-venue-routes-ui.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `970-plan-lending-agent-earn-venue-routes-ui.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/prompts/08-lending.md` (whole file)

~~~~markdown
# 08. Lending and yield from the agent wallet

Read `docs/prompts/README.md` first.

## The problem

Yield data is read-only: `api/defi/` serves protocol and pool yields, and nothing lets an agent deposit idle USDC or SOL into a lending market, track the position, or withdraw. "Earn yield" is a prompt flow in prompt 02 with nothing behind it.

## Build

### Venue

Pick one Solana lending venue by these criteria and record the choice in your report: an on-chain program with a maintained TypeScript SDK, top-three TVL among Solana lending markets, USDC and SOL markets, and no whitelist. Integrate it in `api/_lib/lending/<venue>.js` behind `api/_lib/lending/index.js`. No venue token names in committed code.

### Routes and tools

Under `api/v1/agents/:id/lending/` with MCP tools on `/api/mcp-agent` under the prompt 03 policy:

- `markets` (`lend_markets`): every supported token with supply APY, borrow APY, utilization, available liquidity, and the risk parameters.
- `positions` (`lend_positions`): the agent's deposits and borrows with accrued interest and health factor.
- `deposit/preview` and `deposit` (`lend_deposit`, financial, `confirm_deposit`, fresh `preview_id`).
- `withdraw/preview` and `withdraw` (`lend_withdraw`, financial, `confirm_withdraw`).
- `borrow/preview`, `borrow`, `repay/preview`, `repay` (`lend_borrow`, `lend_repay`, financial) only if the venue supports it safely; otherwise ship deposit and withdraw and say so in the docs.
- `history` (`lend_history`): every action with signatures and interest earned.

Every fund-moving call goes through the agent wallet signer, `enforceSpendLimit`, the anomaly freeze, and the custody ledger.

### Yield automation

- Wallet intent action `earn`: "deposit idle USDC above a reserve of X" and "withdraw when balance below Y", built on `api/_lib/wallet-intents.js` with the existing receipt path.
- A cron `lending-accrual` under `api/cron/` that refreshes position snapshots for the `three://agents/{id}/lending` resource and the page.

### UI

`/agents/:id/earn` page (add to `data/pages.json`): markets with APY, the agent's positions, deposit and withdraw flows with preview then confirm, health factor if borrowing exists, history. Every state designed. Link from the wallet page and the cockpit.

## Docs and wiring

`docs/lending.md` (new) linked from `docs/start-here.md`; `docs/api-reference.md` section; `STRUCTURE.md` row; `data/changelog.json` entry tagged `feature`.

## Acceptance

- Dry run: preview a minimal USDC deposit on the QA agent and stop at the owner confirmation table (gate 1).
- `lend_withdraw` for more than the position returns a validation error before any transaction is built.
- Tests with recorded real RPC fixtures for market parsing and preview math; `npm test` green.
~~~~

