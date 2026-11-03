# Distributed traces from the API through every GPU worker land in Google Cloud Trace

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/740-plan-platform-opentelemetry-gcp-traces.md`.

**Priority:** P2, new capability with clear value (score 46 of 100 inside the tier). **Area:** platform. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

A slow `/forge` request fans out to rembg, a mesh lane, rig and texture workers, and today nobody can say which stage was slow without reading four services' logs by hand. The only cross-cutting instrumentation is Sentry error capture (`api/_lib/sentry.js`). GCP has a first-party Cloud Trace OTLP endpoint, so this is a pre-approved GCP surface with no new vendor. The adoption plan ranked it Tier 1 and nothing has been built.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Not built: `grep -rIl 'traceparent|x-cloud-trace-context|cloudtrace'` over the repo (excluding node_modules) finds only docs and one OKX e2e evidence file. No tracing code in `server/index.mjs`, `api/_lib/upstream-fetch.js`, `api/_providers/gcp.js`, or any worker.
- `api/_lib/sentry.js` deliberately avoids the `@sentry` + `@opentelemetry` instrumentation tree (about 50 MB, cold-start cost); any tracing here must stay out of the per-request hot path of serverless-style handlers and must not reintroduce that bloat.
- The single choke point for outbound calls to workers is `api/_lib/upstream-fetch.js` (`fetchUpstream`, used by `api/_providers/gcp.js` at the submit and poll sites). Production is one Cloud Run container (`server/index.mjs`, Express, `app.listen` near line 722).
- 29 workers have a `main.py` (FastAPI). Shared worker code is vendored byte-identical per worker and guarded by `scripts/check-vendored-workers.mjs` (`VENDORED` list: `worker_security.py`, `oin.py`, `oin_upload.py`, `gltf_meshopt.py`, ...). A new shared tracing module must be added to that list and copied to every worker that uses it.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
grep -rIl 'traceparent\|cloudtrace\|opentelemetry' --include=*.js --include=*.mjs --include=*.py --exclude-dir=node_modules --exclude-dir=.git . | head -20
grep -n 'fetchUpstream' api/_lib/upstream-fetch.js | head -5
sed -n 1,40p scripts/check-vendored-workers.mjs
ls workers/*/main.py | wc -l
gcloud services list --enabled --project aerial-vehicle-466722-p5 | grep -i trace
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Enable Cloud Trace (`cloudtrace.googleapis.com`) on `aerial-vehicle-466722-p5` if not enabled, and grant `roles/cloudtrace.agent` to the `three-ws@` runtime service account (config-only IAM, pre-approved). Record the exact commands in `docs/ops/gcp-production.md`.
2. Add a tiny tracing module for the API process: W3C `traceparent` parsing/generation, a span helper (`withSpan(name, attrs, fn)`), and export to Cloud Trace via OTLP or the `@google-cloud/opentelemetry-cloud-trace-exporter`, initialized once in `server/index.mjs` at boot. Use the OpenTelemetry JS API (`@opentelemetry/api`, `@opentelemetry/sdk-trace-base`) only; do not enable auto-instrumentation of every library. Sampling configurable by env var (default 5 percent, 100 percent for requests carrying a sampled inbound `traceparent`). Tracing failure must never fail a request (fail open, log once).
3. Instrument the request lifecycle at the Express level (root span per `/api/*` request with route, status, user-agent class) and `fetchUpstream` in `api/_lib/upstream-fetch.js`: one child span per outbound call named by the `name` option, injecting `traceparent` into the outbound headers. Cover the Forge path end to end: `api/_providers/gcp.js` submit and poll, and the lane failover walk so a failover appears as sibling spans.
4. Add a vendored Python module (for example `workers/<w>/tracing.py`, byte-identical across workers) that reads the inbound `traceparent`, starts a server span, and exports to Cloud Trace with `opentelemetry-sdk` plus the GCP exporter. Wire it into the FastAPI app of the Forge-path workers first (`rembg`, `model-trellis`, `model-trellis2`, `model-triposg`, `model-pixal3d`, `rig`, `texture`, `segment`, `remesh`), then the remaining workers. Pin the new requirements exactly (`==`) so `npm run audit:deps` can scan them. Add the file to the `VENDORED` list in `scripts/check-vendored-workers.mjs` and make `npm run check:vendored` pass.
5. Tests: `tests/upstream-fetch-tracing.test.js` (traceparent injected on outbound calls, preserved inbound trace id, exporter failure does not fail the call, sampling honoured), a Python test beside the vendored module (`test_tracing.py`, also vendored), and a server-level test that a request with a `traceparent` header yields a span with the same trace id.
6. Verify with a real request: run the dev server pointed at one real worker, submit a Forge job, and confirm in Cloud Trace (`gcloud trace`/console API query via `gcloud` or the Trace REST API) one trace containing the API root span and the worker span with the correct parent/child links. Record the trace id in the report.
7. Docs: a section in `docs/ops/gcp-production.md` (how to find a slow Forge request in Cloud Trace, env vars, sampling), `STRUCTURE.md` if a new directory landed, and a `data/changelog.json` entry only if user-visible (otherwise skip and say why).

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/upstream-fetch-tracing.test.js` passes.
- [ ] `npm run check:vendored` exits 0 with the new module in `VENDORED`.
- [ ] `gcloud services list --enabled --project aerial-vehicle-466722-p5 | grep cloudtrace` shows the API enabled.
- [ ] A real Forge-path request produces a single Cloud Trace trace with spans from the API and at least one worker, parent/child linked (trace id in the report).
- [ ] Cold-start check: the API process boot time with tracing enabled is within 10 percent of baseline (numbers in the report), and the sampled-out path adds no outbound network call.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Cloud Trace exporter library is too heavy for the container | Use OTLP over HTTP to `telemetry.googleapis.com` with the minimal `sdk-trace-base` and a hand-rolled `traceparent` helper; keep the dependency set tiny. |
| A worker image cannot reach the Trace API | Use the runtime service account's default credentials on Cloud Run; if egress blocks it, export through the API process by returning span timings in the job result. |
| Python worker rebuilds are slow | Tracing is additive and fail-open; deploy the Forge-path workers first and leave the rest for the next worker rollout. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/740-plan-platform-opentelemetry-gcp-traces.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `740-plan-platform-opentelemetry-gcp-traces.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/oss-adoption-2026-09.md` (section "OpenTelemetry, for fleet observability")

~~~~markdown
### OpenTelemetry, for fleet observability

**[open-telemetry/opentelemetry-js](https://github.com/open-telemetry/opentelemetry-js)**
(Apache-2.0, 3.5k stars).

The platform runs 115 Cloud Scheduler crons and 30-plus Cloud Run services, and
the only cross-cutting instrumentation is Sentry error capture
([api/_lib/sentry.js](../api/_lib/sentry.js)). There is no distributed trace, so
a slow `/forge` request that fans out to rembg, a mesh lane, rig, and texture
cannot be attributed to a stage without reading four services' logs by hand.

GCP has a first-party OTLP endpoint, so this is a pre-approved-surface adoption
with no new vendor.

**Where it lands:** [server/index.mjs](../server/index.mjs) (boot),
`api/_providers/gcp.js` (propagating `traceparent` to the workers), and each
Python worker's FastAPI app for the far end of the span.
~~~~

