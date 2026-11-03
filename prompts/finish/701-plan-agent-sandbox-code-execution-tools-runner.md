# Give agents sandboxed code execution: runner worker, execute_code and file tools, settings page

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/701-plan-agent-sandbox-code-execution-tools-runner.md`.

**Priority:** P2, new capability with clear value (score 70 of 100 inside the tier). **Area:** agent. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Agents cannot run code, so they cannot do arithmetic on real data, transform a CSV, test a script or build a chart. The sandbox library, tier limits and migration exist, but there is no runner and no tool, so the feature is invisible. Code execution is the most requested capability after web search for agent products.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Built: migration `api/_lib/migrations/20260922220000_agent_sandbox.sql`; `api/_lib/sandbox/{config,exec-core,limits,paths,store,tiers,workspace}.js`; client libs `api/_lib/sandbox/clients/{node,python}/three_ws`.
- Missing: `workers/sandbox-runner` (no directory), agent tools `execute_code`, `terminal`, `read_file`, `write_file`, a `/settings/sandbox` page, run-page execution display, `docs/agent-sandbox.md`, tests for limits and path escape.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
ls workers | grep -i sandbox; ls api/_lib/sandbox api/_lib/sandbox/clients
grep -rn "sandbox/" api/agent api/_mcpagent --include=*.js -l | head
ls tests | grep -i sandbox; ls pages | grep -i sandbox
npm run db:status 2>&1 | tail -6
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Tests first (`tests/sandbox-limits.test.js`, `tests/sandbox-paths.test.js`): path traversal (`../`, absolute paths, symlinks) is refused by `paths.js`; per-tier CPU, memory, wall-clock and output caps are enforced by `limits.js`; workspace quota enforced by `workspace.js`. Fix real defects.
2. Create `workers/sandbox-runner` (Cloud Run service, gVisor sandbox runtime or per-run container with no network by default, read-only root, tmpfs, non-root user, seccomp), a Dockerfile, README and `cloudbuild.yaml` following `workers/texture`. It exposes `POST /exec` consuming `exec-core.js` requests, streams stdout and stderr, enforces `limits.js`, and returns exit code, duration and changed files.
3. Wire `api/_lib/sandbox/exec-core.js` to the runner through the service URL env var; add a bearer between API and worker.
4. Add agent tools `execute_code` (python and node), `terminal`, `read_file`, `write_file` to the agent tool loop and `api/_mcpagent/`, registered in `packages/mcp-policy/src/table.js` (execute write tier). Results are untrusted data. Network egress is off unless the tier allows an allowlist.
5. Page `pages/settings-sandbox.html` at `/settings/sandbox` (entry in `data/pages.json`): tier, quota, workspace file browser, execution history with stdout, kill switch. States: skeleton, empty ("No executions yet. Ask your agent to run code."), error with retry, hover/focus/active.
6. Show executions inline in the agent run page (code, output, duration, files).
7. Docs `docs/agent-sandbox.md`, STRUCTURE.md row, changelog entry; deploy of the worker is the owner gate (list `gcloud builds submit` command from the runbook).

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/sandbox-*.test.js` passes including traversal refusal.
- [ ] Local runner container executes `print(sum(range(10)))` through the API and returns `45`; an infinite loop is killed at the tier wall-clock cap; a network call fails with network off.
- [ ] `/settings/sandbox` verified in a browser in loading, empty, error and populated states.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| gVisor unavailable locally | Use plain Docker with `--network none --read-only --cap-drop ALL` for local proof; Cloud Run gen2 provides the production sandbox. |
| Runner not deployed | Ship everything, verify with the local container, list the exact deploy command. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/701-plan-agent-sandbox-code-execution-tools-runner.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `701-plan-agent-sandbox-code-execution-tools-runner.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/prompts/25-sandboxed-code-execution.md` (whole file)

~~~~markdown
# 25. Sandboxed code execution and scripted tool pipelines for agents

Read `docs/prompts/README.md` first.

## The problem

Runs are tool loops over a read-only registry (`api/agent/run.js`). An agent cannot write and execute a script, transform data, run a backtest, or collapse a twenty-step tool pipeline into one program call. The best agents give the model a sandboxed terminal and an RPC bridge so a script can call tools without spending context on every step.

## Build

- **Execution backends** behind one interface in `api/_lib/sandbox/`: `local` (the local runtime from prompt 20, subprocess with resource limits), `cloudrun` (a Cloud Run job per execution with gVisor, a per-run workspace in GCS mounted read-write, no network except the platform API and an allowlist), `docker` for self-hosters, and `ssh` for a user's own machine. GCP is pre-approved; do not add a third-party sandbox vendor.
- **Tools:** `execute_code` (language, code, timeout, files in and out), `terminal` (persistent session per run), `read_file`, `write_file`. Files persist per run in GCS and are downloadable from the run page.
- **RPC bridge:** inside the sandbox, `three_ws.tool("swap_quote", {...})` calls any tool the run is allowed to use, through a local socket to the runtime, honoring the prompt 03 tiers and confirm rules (financial tools from a script still require a preview and the user's confirm outside the script). A Python and a JavaScript client are pre-installed.
- **Limits:** CPU, memory, wall time and output size per plan; every execution metered in credits; the anomaly guard can kill a run.
- **UI:** the run page shows executions with stdout, stderr, files and cost; `/settings/sandbox` picks the default backend. Every state designed.
- Docs: `docs/agent-sandbox.md` linked from `docs/agent-runtime.md`; changelog entry tagged `feature`.

## Acceptance

- A run asked to "fetch the last 30 days of SOL prices and compute the 7 and 30 day moving averages" writes and executes a script through the Cloud Run backend and returns a chart file.
- A script that calls a financial tool without a preview is refused by the bridge.
- `npm test` green with backend interface and limit tests.
~~~~

