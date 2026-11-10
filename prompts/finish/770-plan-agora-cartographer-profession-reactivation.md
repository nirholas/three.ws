# Agora citizens work as cartographers again, with diorama compose running inside the job budget

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/770-plan-agora-cartographer-profession-reactivation.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 30 of 100 inside the tier). **Area:** agora. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Agora citizens advertise seven working professions; the eighth, cartographer (capability bit 3), is fully written in `workers/agora-citizens/work/cartographer.js` but deliberately left out of `WORK_RUNNERS` because `/api/diorama` `compose` decomposes a scene with an LLM chain whose latency overruns the job budget. Until compose fits the budget, jobs requiring that capability can never be completed by any citizen, and the profession is a hole in the civilization's skill set. Activating it adds a visible, high-signal product (every citizen map is a shareable world, with a verifiable receipt) and exercises the diorama lane. The fix is to solve the latency problem and then enable the runner, not to rewrite it. The note in `workers/agora-citizens/work/index.js` says re-activation is a one-line re-add once the route runs in budget.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `WORK_RUNNERS` in `workers/agora-citizens/work/index.js` holds 7 professions; a comment block explains the cartographer omission.
- `workers/agora-citizens/work/cartographer.js` is complete: it calls `POST /api/diorama` `{action:'compose', prompt}` through `httpJson` in `work/_skills.js` (optional `signal`, no default timeout), validates the plan and returns a deliverable.
- `api/diorama.js` routes `compose` to `composePlanFromPrompt` in `api/_lib/diorama-build.js`. The `three-ws-api` Cloud Run request timeout is 900 s, so the budget in question is the citizen's job window, not the service.
- Tests present: `tests/agora-work-proof.test.js`, `tests/agora-worker-image.test.js`; none exercises the cartographer runner (re-check with `grep -rn -i cartographer tests workers/agora-citizens`). The worker has its own test suite, and worker modules vendored per worker must stay byte-identical (`npm run check:vendored`).
- Task docs `docs/agora/tasks/04-professions.md` list the professions and acceptance, `03-task-supply.md` defines task templates and prices, and `00-INDEX.md` tracks status. Compose latency has not been measured by the reviewer.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
sed -n 1,80p workers/agora-citizens/work/index.js
sed -n 1,60p workers/agora-citizens/work/cartographer.js
grep -n "taskDeadlineSecs\|WORK_TIMEOUT\|workBudget" workers/agora-citizens/*.js workers/agora-citizens/work/*.js | head
grep -rn -i "cartographer" tests workers/agora-citizens --include=*.js -l
ls workers/agora-citizens; head -30 workers/agora-citizens/package.json
grep -n "Cartographer" docs/agora/tasks/04-professions.md | head
node --input-type=module -e "import {composePlanFromPrompt} from './api/_lib/diorama-build.js'; for (const p of ['a lonely lighthouse on a stormy cliff','a cozy campsite in a pine clearing at dusk']) { const t=Date.now(); try { const r=await composePlanFromPrompt(p); console.log(p, Date.now()-t,'ms', Object.keys(r||{})); } catch(e){ console.log('fail', e.message, Date.now()-t); } }"
```

Also time real `POST https://three.ws/api/diorama` `{"action":"compose","prompt":"..."}` calls on the public lane. Record p50 and p95 over at least 10 runs before choosing a path below.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Measure compose latency (Step 0) and write the numbers and the worker's per-task budget into the order report, `workers/agora-citizens/work/README.md` and the Cartographer entry in `docs/agora/tasks/04-professions.md`.
2. Pick the in-budget path from the data. If p95 fits the citizen job window with headroom, just add a per-call timeout and re-enable. If not, either (a) add a fast compose lane: a `mode:'fast'` option in `composePlanFromPrompt` using the smallest suitable Vertex AI Gemini model (GCP credits pre-approved) with a constrained JSON schema and a hard output cap, falling back to the full chain only for non-citizen callers, keeping the output plan schema identical so `@three-ws/scene` and the proof hash still work; or (b) make the runner two-phase (submit the compose job, return a pending receipt, complete on the next tick following the pattern other long-running professions use in `work/index.js`, or use an existing per-runner timeout option). Never raise a global timeout without bound.
3. Test-first: `tests/agora-cartographer-runner.test.js` (or the worker's own test location, e.g. `workers/agora-citizens/test/cartographer.test.js`) running the real runner against a locally started `api/diorama.js` handler, with the LLM transport swapped only at the HTTP boundary by a response recorded in task 1. Assert the deliverable is the canonical plan, the proof is the sha256 of its canonical JSON, the runner is deterministic for a fixed brief, a timeout surfaces a clean typed failure, a compose failure yields an honest failed receipt (no fabricated map), and a plan with an unknown target is rejected.
4. Add `AbortSignal.timeout` to the cartographer call, sized from the measured p95 plus margin and read from config.
5. Re-add `cartographer` to `WORK_RUNNERS`, remove the deferred comment block, update `ACTIVE_PROFESSIONS` consumers (grep for it) and the roster text in `docs/agora.md`.
6. Add a Cartographer task template to the task supply per `docs/agora/tasks/03-task-supply.md` (a themed-map ask, priced inside the existing task price range; read the price table first).
7. Make the result visible: confirm a Cartographer receipt on the citizen passport and receipt panels shows a link to the saved diorama permalink and a thumbnail; if the renderer needs a case for it, add it with a test beside the receipt tests.
8. Confirm the capability bit mapping still holds: `tests/agora-job-board.test.js`, `tests/agora-task-supply.test.js`, `tests/agora-read-model.test.js`, `npx vitest run tests/agora-*.test.js`, `npm run check:vendored` and the worker's whole suite.
9. Exercise one real Cartographer task end to end against the dev API (post a task, let a citizen claim it, receive the deliverable) and record the receipt id.
10. Update status in `00-INDEX.md` and `04-professions.md`, add a `data/changelog.json` entry in community language (citizens now draw maps), run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `grep -n cartographer workers/agora-citizens/work/index.js` shows it inside `WORK_RUNNERS`, and the deferred comment is gone.
- [ ] `npx vitest run tests/agora-cartographer-runner.test.js tests/agora-work-proof.test.js tests/agora-job-board.test.js tests/agora-task-supply.test.js` passes; the worker's whole suite and `npm run check:vendored` pass.
- [ ] The measured p95 of the compose path used by citizens is documented and under the configured job window.
- [ ] One real end-to-end task completed with a receipt that links to a saved diorama (id and link reported).
- [ ] No stub or fake plan appears in any code path (a failed compose throws a typed error).
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| LLM chain credentials missing locally | Take them from the three-ws-api Cloud Run env via the self-unblock playbook; use Vertex AI under the pre-approved GCP credits |
| Compose is too slow for a single request | Build the fast lane or the two-phase runner (task 2); never fake the deliverable, return a canned map, or raise timeouts without bound |
| No funded citizen wallet for the paid task | Use the free-lane or unpaid task template other professions use in dev; any real SOL transfer is covered by Gates |
| A devnet citizen cannot be run | The runner test needs no chain; do not touch the chain-side tests |
| Worker image needs a deploy to take effect | Prepare everything and give the single deploy command; code and tests are done in-session |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Paying citizens from a treasury (any real on-chain transfer) is an on-chain spend: print recipient, amount, token and chain in one table and wait for an explicit yes. Deploying the worker is a production deploy and needs the owner's approval. Batch asks into one message at the end.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/770-plan-agora-cartographer-profession-reactivation.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `770-plan-agora-cartographer-profession-reactivation.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

Code and config the reviewer cited alongside these docs (read them in the repo; they are not copied here): `api/diorama.js`.

- `workers/agora-citizens/work/README.md`
- `workers/agora-citizens/README.md`
- `docs/agora/tasks/04-professions.md`
- `docs/agora/tasks/03-task-supply.md`
- `docs/agora/tasks/00-INDEX.md`

## Status (2026-11-04)

Done: compose latency measured (10 calls on the public lane: p50 about 9 s, p95 about 30 s, job window 3600 s), so no fast lane was needed; per-call timeout with typed `CartographerError` (config `AGORA_CARTOGRAPHER_TIMEOUT_MS`, default 60 s); cartographer re-added to `WORK_RUNNERS`; roster citizen Cato, scene signal routing and a journeyman Cartographer patron tier added; tests in `tests/agora-cartographer-runner.test.js`; docs updated. `verify-supply-chain.mjs --profession cartographer` ran against the live API (proof bc9af6ee...). Remaining: a funded devnet loop run to produce an on-chain receipt id, and saving each map as a diorama permalink with a thumbnail on the receipt panel (the deliverable today is the plan JSON linked as "deliverable").
