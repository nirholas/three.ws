# Ship agent evals: CLI, npm run evals, replay and trajectory export, Evaluate tab, gate wiring

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/705-plan-agent-evals-cli-replay-evaluate-tab.md`.

**Priority:** P2, new capability with clear value (score 64 of 100 inside the tier). **Area:** agent. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Agent quality changes silently when prompts, models or tools change. The eval runner, checks and two suites are written, but nobody can run them: no CLI, no script, no replay of a past run, no UI, and the gate does not use them. Regressions in the trading and smoke behaviors are therefore invisible.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Built: `api/_lib/evals/{checks,configs,execute,models,runner,suites}.js` (`REPORT_SCHEMA = 'three-ws/eval-report@1'`, runner refers to the `agent_evals` table), suites `evals/suites/{smoke,trading}.json`.
- Missing: CLI subcommand, `npm run evals`, replay route, trajectory export, Evaluate tab on the agent page, `docs/agent-evals.md`, tests, gate wiring.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
ls api/_lib/evals evals/suites; grep -n '"evals' package.json
grep -rn "_lib/evals" api scripts packages --include=*.js --include=*.mjs -l | grep -v "_lib/evals"
ls tests | grep -i eval; grep -n "agent_evals" -r api/_lib/migrations | head -3
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Tests first (`tests/agent-evals-runner.test.js`): every check type passes and fails on fixtures; the runner produces a report matching `REPORT_SCHEMA`; a failing case sets non-zero exit; cost is capped per run.
2. `scripts/run-evals.mjs` and `npm run evals -- --suite smoke --agent <id> --model <m> --json out.json`; CLI `three-ws evals run|list|show` in `packages/three-ws-cli/src`.
3. Routes: `POST /api/v1/agents/:id/evals`, `GET /api/v1/agents/:id/evals[/:run]`, `GET /api/v1/agents/:id/runs/:run/replay` (re-executes recorded tool results deterministically) and `GET .../trajectory` (JSONL export).
4. Evaluate tab on the agent page: suite picker, run button, results table with per-case pass/fail and diff, history chart. States: skeleton, empty, error, running progress from real SSE, hover/focus/active.
5. Wire `smoke` suite into `npm run gate` only when an API key env is present, skipping cleanly otherwise.
6. Docs `docs/agent-evals.md`, changelog.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/agent-evals-runner.test.js` passes.
- [ ] `npm run evals -- --suite smoke` against the dev server prints a report with `three-ws/eval-report@1`.
- [ ] Replay of a recorded run reproduces the same tool call sequence.
- [ ] Evaluate tab verified in a browser in all states.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No LLM key | Use the platform proxy via the dev server; suites with `models.js` default to the free tier model. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/705-plan-agent-evals-cli-replay-evaluate-tab.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `705-plan-agent-evals-cli-replay-evaluate-tab.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/prompts/36-agent-evals-and-replay.md` (whole file)

~~~~markdown
# 36. Agent evals and run replay: measure agents before and after every change

Read `docs/prompts/README.md` first.

## The problem

We ship prompt, model and tool changes with no way to know whether agents got better or worse. Runs are logged, but there is no harness that replays a fixed set of tasks against an agent configuration, scores the outcome, and compares versions. The strongest agent projects treat evals and trajectory data as core infrastructure.

## Build

- **Task suites:** `evals/` at the repo root with suites as JSON: task prompt, allowed tools, expected outcome checks (tool called with arguments, final answer contains, cost below, steps below), and a sandbox fixture for tools with side effects (previews only, never executions).
- **Runner:** `npm run evals -- --suite <name> --agent <id or preset> --model <id>` executes each task as a prompt 05 run against production or a local runtime, scores, and writes a report to `evals/reports/` with per-task traces; a comparison mode diffs two reports.
- **Replay:** `POST /runs/:id/replay` re-executes a recorded run's prompts against a different model or skill set with tools in preview-only mode, so a change can be tested on real history.
- **Trajectory export:** `three-ws runs export --format jsonl` for training and analysis, with secrets and memories redacted.
- **Product:** an "Evaluate" tab on the agent page that runs a suite and shows the score history per configuration version. Every state designed.
- Wire a smoke suite into `npm run gate` so a regression in the default preset fails the gate.
- Docs: `docs/agent-evals.md` linked from `docs/agent-runtime.md`; changelog entry tagged `improvement`.

## Acceptance

- The smoke suite scores the default preset on two models and the report shows the difference.
- Replaying a real run in preview-only mode produces no transaction.
- `npm test` green.
~~~~

