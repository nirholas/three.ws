# ARCHITECTURE.md Known Gaps is rewritten to match the code, and the two real env-hygiene gaps are fixed

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/776-plan-docs-architecture-known-gaps-truth-pass.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 26 of 100 inside the tier). **Area:** docs. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The "Known Gaps & In-Progress" section of `ARCHITECTURE.md` is the first place a new engineer or agent looks for open risk, and many of its rows are false today, including three under "Critical / Blocking". Stale warnings waste investigation time and bury the genuinely open items. The reviewer verified each row against the code on 2026-11-03; the stale ones must be corrected or removed and the two true hygiene gaps (env declarations, a runtime-created table) closed.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

Stale or wrong rows:
- "`AGENT_RELAYER_KEY` ... every cold start will throw": `api/_lib/env.js` line ~892 defines it as a lazy `get AGENT_RELAYER_KEY()` that calls `req(...)` only on access, so it only throws on the ERC-7710 paths.
- "`WALLET_ENCRYPTION_KEY` falls back to `JWT_SECRET`": `api/_lib/secret-box.js` fails closed in production on a missing/short dedicated key, uses a random per-record salt, and supports `WALLET_ENCRYPTION_KEY_PREVIOUS` rotation. The JWT_SECRET fallback only decrypts legacy v1 records.
- "Legacy /studio and /dashboard-classic ... not deleted from disk": `pages/studio.html` and `pages/dashboard-classic.html` no longer exist.
- "Reflection model IDs: claude-opus-4-7": `api/_lib/reflection.js` line 30 is `REFLECTION_MODEL = 'claude-opus-5'`.
- "`master_wallets` bootstrapped at runtime": a migration `api/_lib/migrations/20260730040000_master_wallets.sql` exists, but `api/user/wallet/index.js` line ~36 still has an inline `CREATE TABLE IF NOT EXISTS master_wallets`.
- "Agent-screen pool hosting: deploy-ready" is still correct (not deployed); leave it.

True and still open:
- `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (read in `api/agents/_id/livekit-token.js` and elsewhere) and `QSTASH_TOKEN` (`api/_lib/qstash.js`, `api/cron/quota-check.js`) are read by `process.env` directly and are not declared in `api/_lib/env.js`.
- Not verified as stale and left to the executing agent: `ValidationRegistry`/`AgentPayments.sol` deployment status (owner-only on-chain deploys; these rows stay factual), `X402_SELF_FACILITATOR_ENABLED`, `MARKETPLACE_PLATFORM_FEE_BPS`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
sed -n 3014,3075p ARCHITECTURE.md | cut -c1-200
sed -n 885,900p api/_lib/env.js; grep -n "WALLET_ENCRYPTION_KEY" api/_lib/secret-box.js | head
ls pages/studio.html pages/dashboard-classic.html 2>&1; grep -n "REFLECTION_MODEL =" api/_lib/reflection.js
grep -rn "CREATE TABLE IF NOT EXISTS master_wallets" api --include=*.js
grep -rn "LIVEKIT_API_KEY\|LIVEKIT_API_SECRET\|QSTASH_TOKEN" api --include=*.js | grep -v "api/_lib/env.js" | head
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. For every row in the three Known Gaps tables, re-verify against the code with the commands above and `grep`; produce the corrected table in place. Delete rows that are fixed, rewrite rows that are partly true, keep the true ones with a measured date, and add the evidence path to each row.
2. Env hygiene (test first): add a case to the existing env test (find it with `ls tests | grep -i env`) asserting `env.LIVEKIT_API_KEY`, `env.LIVEKIT_API_SECRET` and `env.QSTASH_TOKEN` exist as optional getters returning `undefined` when unset (no throw). Then add the optional getters to `api/_lib/env.js` and switch the direct `process.env` reads in `api/agents/_id/livekit-token.js`, `api/_lib/qstash.js` and `api/cron/quota-check.js` to use them. Confirm no behavior change when the vars are set.
3. Remove the inline `CREATE TABLE IF NOT EXISTS master_wallets` in `api/user/wallet/index.js` only after proving production already has the table (`npm run db:status` shows the migration applied, and a read-only `select to_regclass('master_wallets')` against the DB); if the migration is not applied everywhere, keep the inline bootstrap and record why. Never run `npm run db:migrate` without reading `db:status` first.
4. Keep `data/changelog-telegram-state.json` and the two x402 modal packages as factual rows only (they are decisions, not defects). Run `npm run audit:docs`.
5. Add a `data/changelog.json` entry only for the code changes in task 2 and 3, then `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `grep -n "AGENT_RELAYER_KEY.*cold start\|falls back to .JWT_SECRET\|claude-opus-4-7\|dashboard-classic" ARCHITECTURE.md` prints nothing (or only rows that are now accurate).
- [ ] `grep -n "LIVEKIT_API_KEY\|QSTASH_TOKEN" api/_lib/env.js` matches; `grep -rn "process.env.QSTASH_TOKEN\|process.env.LIVEKIT_API" api` prints nothing outside `env.js`.
- [ ] The env test passes and `npm run audit:docs` passes.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Cannot confirm the master_wallets table in prod | Use a read-only `to_regclass` query via the repo's DB helper; if still unconfirmed, leave the inline bootstrap and document the evidence gap in the row. |
| A row concerns an on-chain deploy | Record it as owner-gated fact; do not deploy contracts. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/776-plan-docs-architecture-known-gaps-truth-pass.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `776-plan-docs-architecture-known-gaps-truth-pass.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `ARCHITECTURE.md` (section "Known Gaps & In-Progress")

~~~~markdown
## Known Gaps & In-Progress

### Critical / Blocking

| Item | Impact | File |
|------|--------|------|
| `AGENT_RELAYER_KEY` declared `req()` in `env.js` but only needed for ERC-7710 paths | Every cold start of any API function importing `env.js` will throw if unset | `api/_lib/env.js` |
| `WALLET_ENCRYPTION_KEY` falls back to `JWT_SECRET` if unset | All custodial wallet confidentiality tied to session secret | `api/_lib/agent-wallet.js` |
| `ValidationRegistry` not deployed on mainnet | GLB validation attestations cannot be written on mainnet | `contracts/src/ValidationRegistry.sol` |
| `AgentPayments.sol` not deployed anywhere | All EVM agent payment addresses are `0x000…000` | `contracts/src/AgentPayments.sol`, `agent-payments-sdk/src/evm/addresses.ts` |

### In-Progress Features

| Feature | Status | Notes |
|---------|--------|-------|
| ERC-7710 delegation redemption | Opt-in, disabled by default | `PERMISSIONS_RELAYER_ENABLED` flag; `POST /api/permissions/redeem` is the incomplete path |
| `AgentPayments.sol` EVM deployment | Written, not deployed | All `agentPayments` addresses in `addresses.ts` are zero-address placeholders |
| ValidationRegistry mainnet | Testnet only | No mainnet reference deployment; platform validator key `0x93Bc7EfB…` provisioned but not configured or funded |
| Trading swarms UI | Backend + `/swarms` dashboard live; 3D Sniper Arena at `/play/arena` | `api/swarms/*`, `src/play/arena.js`, swarms tables |
| Agora economy | **Launched** (Commons live at `/agora`; Arena/Guild migration 2026-07-02) | Agent + human citizens, professions, verifiable WORK supply chain - see [Agora](#agora--living-agent--human-economy-verifiable-work-supply-chain) |
| Self-hosted x402 facilitator | Shipped, **off by default** | `X402_SELF_FACILITATOR_ENABLED` + sponsor secret required; `api/x402-facilitator` returns 503 otherwise |
| Autonomous coin launcher | Live (`launcher_config` defaults flipped to LIVE) | Real SOL, circuit-broken, storage-preflighted |
| Agent-screen pool hosting | Deploy-ready, not yet deployed | `workers/agent-screen-pool/cloudbuild.yaml` builds + deploys it as an always-on Cloud Run service; until that submit runs, watched cards stay on the zero-cost activity view (`/api/agent/watch-status` gates warming/queued on pool liveness) |

### Technical Debt

| Item | Notes |
|------|-------|
| No GitHub Actions CI/CD | The project doesn't use `.github/workflows` for CI/deploy. Deploys run via Cloud Build (`npm run deploy:gcp`), schedules via Cloud Scheduler; the local `gate`/`audit`/`smoke` scripts are the push-time quality bar. Renovate handles dependency updates |
| `master_wallets` table bootstrapped at runtime | `CREATE TABLE IF NOT EXISTS` inline rather than via migration - schema drift risk |
| Two x402 payment protocols using HTTP 402 | CDP x402 v2 (`x402-spec.js`) and pump.fun agent-payments 402 (`x402.js`) coexist with no unified protocol guide |
| `THREE_TREASURY_WALLET` / `THREE_REWARDS_WALLET` / `THREE_QUOTE_SECRET` | Required in production and still fail at first use, not at startup (deliberate: a wrong address must never silently take real money). Since 2026-09-20 the condition is no longer invisible: the `three_token_rail` subsystem in `/api/healthz` reports `down` and names the unset vars, and each one now fails with a typed, coded 503 instead of a sanitized 500 |
| Upstash free-tier quota risk | June 2026 outage documented; quota guard requires optional env vars not guaranteed to be set |
| Multiple OG image endpoints | `@sparticuz/chromium-min` one-time `/tmp` download per cold start, no persistent cache |
| `MARKETPLACE_PLATFORM_FEE_BPS` defaults to 0 | Fee is inert unless explicitly set |
| `x402-modal-sdk` vs `x402-payment-modal` | Two near-identical modal packages (v0.2.0 and v1.2.0) - consolidation opportunity |
| `pumpfun-mcp` vendor copy in `src/tools.js` | Must be kept manually in sync with `api/pump/mcp-tools.js` |
| `data/changelog-telegram-state.json` committed | Accumulates diffs on every push, exposes internal state in PRs |
| Legacy `/studio` and `/dashboard-classic` | 301 to new dashboard but old pages not deleted from disk |
| `apps-sdk/embodiment/` | No `package.json` or build script - raw JS helpers with no version path |
| Withdrawal execution is async | `agent_withdrawals` rows created as 'pending'; actual on-chain transfer worker location unclear in `api/` tree |
| Reflection model IDs | `claude-opus-4-7` model ID referenced in `api/_lib/reflection.js` - verify against Anthropic API |
| LLM provider health | `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` noted as 'over quota' / '401s in prod' in `api/_lib/chat-models.js` - final fallback tier degraded |
| `gRPC` runtime compatibility | `api/_lib/a2f-nvidia.js` and `api/_lib/asr-nvidia.js` require Node runtime (not Edge) - no explicit `runtime` declaration found |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Used in `api/agents/[id].js` but not declared in centralized `api/_lib/env.js` |
| `QSTASH_TOKEN` | Read directly via `process.env` rather than `env.js` - inconsistent pattern |
| Skill-license marketplace initialization | `initialize_marketplace` tx not confirmed as having run on mainnet |
| animation-sources/ population pipeline | `scripts/download-mixamo-animations.js` / `fetch-animations.sh` not automated in CI |
| Payment reconciliation is not a cron file | The daily revenue-reconciliation job is autonomous-registry entry `revenue-reconciliation` (self/027) executed inside `api/cron/x402-autonomous-loop.js` (`*/5`), not a standalone `api/cron/*` - do not confuse with `api/cron/reconcile-decisions.js` (oracle predictions) |
| Trading Brain vs Sniper paths | `src/studio/money/trading-brain.js` shares the sniper compiler/backtester/DB but drives a partly separate discretionary path (`api/trading/*`, `api/strategies`, `api/agents/:id/strategies`) - two execution surfaces to keep in sync |

---

*This document is the authoritative architecture reference for three.ws. For surface-level routing, see `STRUCTURE.md`. For API endpoint details, consult `api/openapi-json.js`. For on-chain deployments, see `contracts/DEPLOYMENTS.md`.*

---
~~~~

