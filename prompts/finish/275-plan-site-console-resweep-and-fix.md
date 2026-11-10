# Re-run the full console sweep on a quiet box, fix every real error, and gate the result with a baseline

**Status (2026-11-04):** Task 5 already shipped: `scripts/audit-console.mjs` judges its exit code against `scripts/audit-console.baseline.json` through `scripts/lib/console-baseline.mjs` and supports `--update-baseline`. The sweep itself (tasks 1 to 4, 6, 7) was not run because the box was not quiet (1-minute load 59 on 32 cores, with about ten concurrent agents), and the order says to sweep only when load is below the core count. Owner or next quiet session: run the Step 0 commands, then classify and fix.

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/275-plan-site-console-resweep-and-fix.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 66 of 100 inside the tier). **Area:** site. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

CLAUDE.md makes a clean browser console part of the Definition of Done, and `scripts/audit-console.mjs` is the lasting check. The last full sweep is from 2026-09-09 (798 routes, 31 failing, 70 errors); the site has shipped weeks of change since, and the page index now lists about 1,015 entries. The 09-09 run was taken at machine load 80 to 100, and the tool's own header records that 29 of those 31 passed on a quiet box, so the old failure list is mostly noise and cannot be worked from directly. Nobody has produced a trustworthy, current list. Real console errors on money pages (`/markets/*`, `/agent-wallet`, `/wallet`, `/trading`, `/credits`, `/payments`, `/dashboard`) hurt users and hide real regressions.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `scripts/audit-console.mjs` exists (`npm run audit:console`), flags `--report --desktop --mobile --no-blog`, env `AUDIT_BASE`, `CONCURRENCY`, `DEV_API_PROXY`. It retries failures serially and filters environment noise.
- Reports in `docs/audit/`: 2026-09-04, 09-07 (105KB), 09-09 (31 failing routes, listed under "Failures (detail)": `/globe`, `/ibm/hello`, `/markets`, `/markets/robinhood/*`, `/markets/news`, `/event`, `/swarms`, `/agent-wallet`, `/wallet`, `/trading`, `/exit-lab`, `/pill`, `/agents`, `/spotlight`, `/ledger`, `/my-agents`, `/reputation`, `/reputation/market`, `/preflight`, `/credits`, `/payments`, `/pay/simulator`, `/login`, `/dashboard`, `/dashboard/account`, and more).
- No sweep newer than 2026-09-09 exists in `docs/audit/`. No CI gate or baseline file tracks the count (other audits have `*.baseline.json`, for example `scripts/audit-interactive-states.baseline.json`).

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
uptime                      # run the sweep only when the 1-minute load is below the core count
nproc
ls docs/audit/console-sweep-*.md
node --env-file-if-exists=.env --env-file-if-exists=.env.local server/index.mjs &   # repo's own API on :8080
DEV_API_PROXY=http://localhost:8080 npx vite --port 3211 --strictPort &
AUDIT_BASE=http://localhost:3211 CONCURRENCY=3 npm run audit:console -- --report
```

Then re-run the failing routes alone a second time against the default proxied API (`https://three.ws`) to separate working-tree defects from deploy lag, exactly as the tool header describes. A route is a defect only if it fails on a quiet box in both runs or fails against the local API.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Run the sweep as in Step 0 and keep the raw report under `docs/audit/console-sweep-<today>.md` (generated by `--report`).
2. Classify each failing route: working-tree defect, deploy lag (clears against local API), environment noise (add to the tool's noise filter only with a stated reason in a code comment), or load flake (clears on re-run).
3. For each working-tree defect, work test-first where a unit seam exists (a parse, a null deref, a bad URL builder): write the test beside the module in `tests/`, see it fail, fix. Pure console noise from a third-party script needs no test; say so in the report.
4. Fix at the source, never by suppressing the console message. Typical causes seen in earlier sweeps: a texture or module fetch to a dead URL, an `/api/*` call made before auth resolves, a missing optional DOM node, an uncaught promise from a worker.
5. Add `scripts/audit-console.baseline.json` recording the accepted route to error-count map (empty target), make `audit-console.mjs` print a clear diff against it and exit non-zero on a new error, and document the quiet-box rule in `docs/audit/README.md` (create it if absent, link from the report).
6. Re-run until the report says zero failing routes on both viewports, or each remaining route is listed with a reason that is genuinely external.
7. Where a failure is a dead link or missing asset, add the check to the link/asset audits (`npm run audit:links`, `npm run audit:pages`) test-first so it cannot return.
8. Changelog entry only if a user-visible page behavior changed; then `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `docs/audit/console-sweep-<today>.md` exists and its header reads "0 route(s) with errors" (or lists only externally caused routes with reasons).
- [ ] The final sweep ran at load below core count (record `uptime` in the report) against a server this session started.
- [ ] `node scripts/audit-console.mjs / /forge /agent-wallet /credits` exits 0 on desktop and mobile.
- [ ] `scripts/audit-console.baseline.json` exists, and introducing a deliberate `console.error('x')` on `/` makes the audit exit non-zero (then revert the probe).
- [ ] `npm run audit:links` and `npm run audit:pages` pass.
- [ ] Every defect fixed with a seam has a test observed failing first.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Swiftshader makes WebGL pages slow or flaky | Raise the settle window for those routes in the tool, or sweep them with `CONCURRENCY=1`; do not mark a route clean from a timed-out load. |
| Port 3000 is owned by another agent | Use your own port via `AUDIT_BASE` and `--port 3211 --strictPort`. |
| An error comes from production lagging main | Prove it with the local-API run, record it as deploy lag, and do not change code. |
| Shared box under load causes false failures | Serial retry as the tool does and trust only the retry reading on a quiet box. |
| Third-party origin blocks headless | Document it with the response evidence as externally caused; do not suppress the console check. |
| Playwright browsers are missing | `npx playwright install chromium` (local, no approval needed). |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/275-plan-site-console-resweep-and-fix.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `275-plan-site-console-resweep-and-fix.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

Code and config the reviewer cited alongside these docs (read them in the repo; they are not copied here): `scripts/audit-console.mjs`.

- `docs/audit/console-sweep-2026-09-09.md` (section "Failures (detail)")
- `docs/audit/console-sweep-2026-09-04.md`
- `docs/audit/console-sweep-2026-09-07.md`
- `docs/audit/console-sweep-2026-09-09.md`
