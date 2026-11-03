# Autopilot gets a guarded trade action and a trading MCP server (quote, positions, execute)

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/968-plan-autopilot-trade-action-and-trading-mcp.md`.

**Priority:** Gated, the last step needs an owner action or outside party (score 66 of 100 inside the tier). **Area:** autopilot. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Agents can create alerts, author briefings and send native SOL through autopilot, but they cannot trade. Autonomous, owner-bounded buying and selling of pump.fun coins in SOL is the highest-value behaviour users ask for, and $THREE must stay a one-way valve (buy and burn, never sell). The server-signed, guarded trade path already exists in `api/agents/solana-trade.js`; what is missing is the autopilot `trade` kind that routes through it, the sell ban for $THREE on that path, and an MCP surface (`quote_trade`, `list_positions`, `execute_trade`) so clients and the proposal generator can use it. Real mainnet execution is the owner gate. Everything up to it is built and verified with quotes, dry runs and simulation.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `api/_lib/autopilot.js` defines `AUTOPILOT_ACTION_KINDS` (create_alert, briefing, wallet_transfer), the `ACTION_TYPE` map, `AUTOPILOT_DEFAULTS.scopes`, `validateProposal`, `validateWalletTransfer`, `dailySolSpent`, `dryRunProposal`, `executeProposal` and `executeWalletTransfer`. There is no `trade` kind, no `autopilot.trade.executed` action type, and no `validateTrade`.
- `grep -rn three_sell_forbidden api` returns nothing: the code the spec calls "the v0.2.0 case" is not present. `THREE_CA` is imported from `api/_lib/three-gate.js` and `wallet_transfer` already refuses $THREE outflow in `validateWalletTransfer`.
- Reusable, already shipped: `api/agents/solana-trade.js` (preview quotes, `submitProtected`, custodial signing via `recoverSolanaAgentKeypair`), `api/_lib/agent-trade-guards.js` (`enforceDestinationAllowlist`, `recordCustodyEvent`, `updateCustodyEvent`, `SpendLimitError`), `api/_lib/pump-trade-args.js`, `api/_lib/trade-firewall.js`. Tests: `tests/agent-trade-endpoint.test.js`, `tests/solana-trade-guards.test.js`, `tests/agent-trade-x402.test.js`, `tests/autopilot.test.js`, `tests/autopilot-run-dry-run-default.test.js`.
- MCP packages that exist: `packages/autopilot-mcp`, `packages/portfolio-mcp` (tools: portfolio-summary, portfolio-asset, portfolio-history, wallet-balances, preview-transfer, send-transfer, trades-feed), `packages/pumpfun-mcp`, `packages/intel-mcp`, `packages/signals-mcp`, `packages/alerts-mcp`. There is no `packages/trading-mcp`.
- `npm run test:mcp` runs `scripts/test-mcp-all.mjs`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
grep -n "AUTOPILOT_ACTION_KINDS\|ACTION_TYPE\|validateTrade\|autopilot.trade" api/_lib/autopilot.js
grep -rn "three_sell_forbidden" api packages tests | head
ls packages | grep -E "trading|autopilot|portfolio"
sed -n 1,80p api/agents/solana-trade.js
grep -n "export" api/_lib/agent-trade-guards.js
npm run test:mcp 2>&1 | tail -15
```

Skip anything already built.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first: add cases to `tests/autopilot.test.js` (or a new `tests/autopilot-trade.test.js`) for `validateTrade`: rejects a sell whose mint is `THREE_CA` or the alias `three` with code `three_sell_forbidden`; allows a buy of $THREE; rejects `amount_sol <= 0`, a missing amount, a bad mint, `max_slippage_bps` above the hard ceiling (500); defaults slippage to 100 bps; accepts `amount_tokens: "all"` for sells. Run them and confirm they fail because the symbols do not exist.
2. In `api/_lib/autopilot.js`: add `trade` to `AUTOPILOT_ACTION_KINDS`, `ACTION_TYPE.trade = 'autopilot.trade.executed'`, `scopes.trade: false` in `AUTOPILOT_DEFAULTS`, and extend `normalizeAutopilotConfig` and `auto_execute` handling so `trade` is never auto-executable for buys. Implement `validateTrade` per `docs/specs/agent-trading.md` (side, mint, amount_sol or amount_tokens, max_slippage_bps, reason) and wire it into `validateProposal`. Treat `trade` as irreversible in `executeProposal` (the `irreversible` check currently only names `wallet_transfer`) so `confirmed` is required while `require_confirm` is true.
3. Add `executeTrade` beside `executeWalletTransfer`: enforce the daily SOL cap with `dailySolSpent` for buys (sells do not add to the tally), the per-trade cap, a max-open-positions limit stored in the autopilot config, and slippage bounds. Route the actual swap through the existing path in `api/agents/solana-trade.js` and `api/_lib/agent-trade-guards.js` (quote, `trade-firewall`, `submitProtected`). Do not add a second swap implementation. Write a `recordCustodyEvent` before submit and `updateCustodyEvent` after (the pattern in `executeWalletTransfer`), then a signed `agent_actions` row with mint, side, amounts, signature, realized SOL and the proposal provenance, and a receipt through `buildReceipt`. A failed trade must not leave a pending custody row.
4. Extend `dryRunProposal` for `trade` so a dry run returns the live quote, expected out, price impact and the guard verdicts without signing or submitting anything. The default for autopilot runs stays dry run (see `tests/autopilot-run-dry-run-default.test.js`).
5. Create `packages/trading-mcp` (version 0.1.0, same layout as `packages/portfolio-mcp`: `package.json`, `README.md`, `src/index.js`, `src/tools/`, `test/`) with `quote_trade` (read), `list_positions` (read, reuse the portfolio data source, cost basis and unrealized PnL) and `execute_trade` (write, destructive, requires `confirm:true`, refuses a $THREE sell). Lazy-import `@solana/spl-token` as `portfolio-mcp`'s `send_transfer` does. Tool descriptions must state the SOL-only, $THREE-buy-only rules accurately. Register the package in `scripts/test-mcp-all.mjs` and wherever packages are listed (`STRUCTURE.md`, `docs/mcp.md` if present).
6. Let `generate_proposals` (in `api/_lib/autopilot.js` and the `packages/autopilot-mcp` tool of the same name) emit `trade` proposals grounded in real `intel-mcp` and `pumpfun-mcp` signal memories, each carrying `source_memory_ids`. Never hardcode a mint in source or proposals: mints come from runtime discovery only. Bump `packages/autopilot-mcp` and update its README.
7. Add the owner UI: the autopilot scope toggle for `trade`, the per-trade cap and max positions fields, and the trade proposal card (quote, guards, Confirm). Find the existing autopilot settings surface with `grep -rln autopilot src pages public --include=*.js --include=*.html`, add hover, focus and active states, a designed empty state ("no trade proposals yet, signals will appear here") and an actionable error state, with skeleton loading. Verify in a real browser against the dev server using dry run only.
8. Tests for the whole path in `tests/autopilot-trade.test.js` and `packages/trading-mcp/test/`: scope denied, confirmation required (428), budget exceeded, $THREE sell refused at validate and at execute, slippage exceeded, insufficient funds, failed submit leaves the custody row failed, receipt shape. Use the repo's real quote endpoints in dry run; no fixtures standing in for market data.
9. Docs: update `docs/specs/agent-trading.md` status from proposed to the phase actually shipped, add `packages/trading-mcp/README.md`, a `STRUCTURE.md` row, and a `data/changelog.json` entry. Run `npm run test:mcp`, `npm test`, `npm run audit:docs`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `grep -n "three_sell_forbidden" api/_lib/autopilot.js` finds the guard, and the new tests covering it pass (shown failing first).
- [ ] `npm run test:mcp` is green and includes `packages/trading-mcp`.
- [ ] A dry-run `trade` proposal returns a live quote and guard verdicts without any signature, observed in a real browser and via the MCP tool.
- [ ] A buy without `confirm:true` returns 428 `confirmation_required`; a sell of $THREE returns `three_sell_forbidden` from both the autopilot path and `execute_trade`.
- [ ] No mint address other than `THREE_CA` appears in any committed source, test or doc.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Cannot execute a real swap to verify | Verify to the gate with quotes, dry run, and the transaction simulation the existing `solana-trade.js` path already supports. Record exactly what was and was not exercised on mainnet |
| Need a test mint | Use `THREE_CA` or a clearly synthetic address in tests; use runtime discovery only for live dry-run checks |
| Daily cap or custody tables behave oddly | Read `dailySolSpent` and `recordCustodyEvent` in the repo and mirror `executeWalletTransfer`, which is the working precedent |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

The first real mainnet buy or sell is an irreversible spend action under CLAUDE.md gate 1. Build, test and verify everything on quotes, dry run and simulation. The single live execution check is one batched ask at the end of the session: render recipient (the venue), amount in SOL, token and chain, and wait for the owner's explicit yes. The order must not execute a real trade on its own.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/968-plan-autopilot-trade-action-and-trading-mcp.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `968-plan-autopilot-trade-action-and-trading-mcp.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/specs/agent-trading.md` (whole file)

~~~~markdown
# Spec - Agent trading capability (Feature B)

Status: **proposed** · Author: three.ws · Depends on: autopilot v0.2.0 (SOL spend cap + $THREE buy-only guard)

## Why

Today an agent's autopilot can create alerts, author briefings, and send **native SOL**. It cannot trade. The realistic, high-value autonomous behavior users want is **buying and selling pump.fun coins in SOL** - sniping new launches and acting on alpha - while treating **$THREE as buy-only** (accumulate/burn, never sell). This spec adds that capability on top of the v0.2.0 foundation.

## Principles (inherited from v0.2.0)

1. **SOL is the spend currency.** Every buy is denominated in SOL and counts against the daily SOL cap (`daily_spend_sol`). Sells return SOL.
2. **$THREE is a one-way valve.** The agent may *buy* $THREE (SOL → $THREE) and *burn* it, but a **sell of $THREE (or any transfer out of $THREE) is hard-refused server-side** - the same guard `validateWalletTransfer` already enforces, extended to the swap path.
3. **Runtime mints only.** Coins to trade are supplied at runtime (mint address from discovery/intel). Never hardcode, market, or recommend a specific non-$THREE mint in source, copy, or proposals (CLAUDE.md). $THREE remains the only coin the platform promotes.
4. **Server-side enforcement.** Scope, caps, slippage bounds, and the $THREE-sell ban live in `api/_lib/autopilot.js` / a new trade guard - the MCP client cannot bypass them.

## New autopilot action kind: `trade`

Extend `AUTOPILOT_ACTION_KINDS` with `trade` and `ACTION_TYPE.trade = 'autopilot.trade.executed'`.

**Params** (validated by a new `validateTrade`):
```
{
  side: "buy" | "sell",
  mint: "<solana mint>",          // the coin to trade; "three"/$THREE allowed for side:"buy" ONLY
  amount_sol?: number,            // required for buy - SOL to spend (counts against daily cap)
  amount_tokens?: number | "all", // required for sell - token units (or all) to sell back to SOL
  max_slippage_bps?: number,      // default 100 (1%), hard ceiling e.g. 500
  reason: string
}
```

**Guards** (all server-side, deny - never partial-execute):
- `side:"sell"` with `mint === $THREE` (or the CA) → **refused** (`code: 'three_sell_forbidden'`). This is the buy-only valve.
- `side:"buy"`: `amount_sol > 0`, `spent_24h + amount_sol ≤ daily_spend_sol`, scope `trade` granted, `confirm:true` (reuse the irreversible-confirmation policy).
- `side:"sell"`: agent must hold the position; slippage within `max_slippage_bps`.
- Reuse `dailySolSpent` for buys; sells do not add to the spend tally (they return SOL).

## Execution path

Reuse existing building blocks - do **not** add a new swap implementation if one is reusable:
- Quote: `@three-ws/pumpfun-mcp` already exposes `pumpfun_quote_swap` / `quote_swap`; the backend equivalent should quote via the same Jupiter/pump.fun route.
- Buy: pattern already proven in `avatar-agent-mcp` (`pump_buy`) and the agent custodial wallet path (`recoverSolanaAgentKeypair`, `submitProtected`).
- Settle: bundle/submit via the same protected-send path used by `transferNativeSol`.
- Record: write a signed `agent_actions` row (`autopilot.trade.executed`) with provenance, mint, side, amounts, signature, realized SOL - same receipt discipline as `wallet_transfer`.

## MCP surface

Two options - **recommended: a dedicated `@three-ws/trading-mcp`** rather than overloading autopilot, because trading has its own discovery + quote + position surface:
- `quote_trade` (read) - price + expected out + slippage for a prospective buy/sell.
- `list_positions` (read) - open positions with cost basis + unrealized PnL (reuse `portfolio-mcp` data).
- `execute_trade` (write · destructive) - buy/sell in SOL; `confirm:true`; $THREE-sell refused.
- Autopilot integration: `generate_proposals` may emit `trade` proposals (grounded in `intel-mcp` smart-money / signal memories); they flow through the existing dryrun → confirm → execute → signed-receipt loop.

`portfolio-mcp`'s `send_transfer` already lazy-loads `@solana/spl-token`; the trading server should follow the same lazy-import discipline to avoid the ESM load crash.

## Discovery → decision (where alpha comes from)

Trading proposals should cite real signals, never guess:
- `intel-mcp` - smart-money score, KOL trades, signal-feed accuracy.
- `pumpfun-mcp` - new/trending/graduating tokens, bonding-curve + holder analysis.
- Alert fires (`alerts-mcp`) → a candidate `trade` proposal the owner reviews.

## Risk & limits

- **Per-trade cap** + **daily SOL cap** (existing) + **max open positions** + **slippage ceiling**.
- **Confirmation**: buys/sells are irreversible → `require_confirm` applies, like `wallet_transfer`.
- **Trust gating**: only agents at `trusted`/`autonomous` trust may auto-execute reversibly-scoped trades (sells of a held position); buys always confirm.
- **No $THREE sell, ever** - enforced at validate + execute, covered by a test mirroring the v0.2.0 `three_sell_forbidden` case.

## Phased plan

1. **Quotes + positions (read-only):** `quote_trade`, `list_positions` over live routes. No funds move. Ship + verify.
2. **Buy (SOL → coin):** `execute_trade side:"buy"`, confirm-gated, daily-cap-bounded, signed receipt.
3. **Sell (coin → SOL):** `execute_trade side:"sell"` for held positions; $THREE-sell hard-refused.
4. **Autopilot `trade` proposals:** generation from intel/signal memories → dryrun → confirm → execute.
5. **Changelog + docs** at each phase; publish `@three-ws/trading-mcp` (start 0.1.0) and bump `autopilot-mcp` when the `trade` kind lands.

## Definition of done (per phase)

Real routes (no mocks), server-side guards with tests (including the $THREE-sell refusal), confirm-gated irreversible actions, signed `agent_actions` receipts, MCP descriptions accurate, changelog entry, and `npm run test:mcp` green.
~~~~

