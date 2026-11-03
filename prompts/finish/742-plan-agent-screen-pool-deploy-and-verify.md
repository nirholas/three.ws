# The Agent Screen casting pool is deployed, wired to the API secret, and proven end to end

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/742-plan-agent-screen-pool-deploy-and-verify.md`.

**Priority:** P2, new capability with clear value (score 45 of 100 inside the tier). **Area:** agent-screen. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Agent Screen lets an agent's live browser tasks be cast as frames onto a screen in its 3D scene. The pool worker (`workers/agent-screen-pool`) that produces those frames is not running in production, so watched agents show "warming up" or nothing, and every API surface built for it (push, control drain, watch-status liveness gate) has no producer. The code, the proof scripts and the deploy config exist; the missing work is the verified deploy sequence in the order the README requires and a live end-to-end check.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Worker: `workers/agent-screen-pool/{index.js,control.js,task-runner.js,tasks/,Dockerfile,cloudbuild.yaml}`; proof scripts `scripts/agent-screen-pool-proof.mjs` and `scripts/agent-screen-control-proof.mjs`.
- API side: `api/agent-screen-push.js`, `api/agent-screen-control-drain.js`, `api/agent/watch-status.js` (pool-liveness gate, `SCREEN_POOL_MAX` mirrors the worker's `MAX_BROWSERS`, default 6), `api/agent/anchor-script.js`; all read `SCREEN_WORKER_SECRET`.
- `gcloud run services list` showed no `agent-screen-pool` service on 2026-11-03. The secret `screen-worker-secret` is the Secret Manager source (verify it exists).
- The service must run `--min-instances=1 --max-instances=1` and `--no-cpu-throttling` (two instances would double-push frames).

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
gcloud run services list --region us-central1 --project aerial-vehicle-466722-p5 --format='value(metadata.name)' | grep -i screen
gcloud secrets list --project aerial-vehicle-466722-p5 --format='value(name)' | grep -i screen-worker
gcloud run services describe three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --format=json | grep -c SCREEN_WORKER_SECRET
node scripts/agent-screen-pool-proof.mjs
node scripts/agent-screen-control-proof.mjs
grep -n "assertResolvedPublic\|isAddressAllowed\|routeWebSocket\|context.route" workers/agent-screen-pool/*.js | head
```

Egress guard check: if the grep above shows the worker already applies a request-level resolved-address check (context-wide route handler that refuses non-public addresses), continue. If it is missing, include the minimal guard in this order before deploying: a `context.route('**/*', ...)` handler in the worker that resolves each request hostname with `dns.promises.lookup({all:true})` and aborts with `blockedbyclient` when any address is private, loopback, link-local or CGNAT, with a test covering 10.0.0.1, 127.0.0.1 and 169.254.169.254. Do not wait for any other order to deliver it; the full guard (response server-address check, `homeUrl` coverage, docs) belongs to `agent-screen-pool-egress-guard`, which stays a separate order.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Run both proof scripts and fix any failure at the root cause (they exercise the real worker against a local server speaking the production wire contract with real Chromium).
2. Verify the secret exists in Secret Manager (`screen-worker-secret`); create it with a fresh 64-hex value if missing and grant the runtime service account `secretAccessor`.
3. Ordering matters (README): (a) confirm the deployed API revision already carries the pool-liveness gate in `api/agent/watch-status.js`; if not, include the API in the deploy first. (b) Hand the API the secret: `gcloud run services update three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --update-secrets=SCREEN_WORKER_SECRET=screen-worker-secret:latest` (config-only, merges). (c) Submit the worker build: `gcloud builds submit workers/agent-screen-pool --config workers/agent-screen-pool/cloudbuild.yaml --region us-central1 --project aerial-vehicle-466722-p5`. The production deploy is the routine gate: run it only if the owner's instruction approves deploys, otherwise leave the three commands ready.
4. Set `SCREEN_POOL_MAX` on the API only if the worker's `MAX_BROWSERS` is changed from 6; if memory is raised for more pages, raise `--memory` (about 350 MB per page).
5. Live check: watch an agent on its public page, confirm `GET /api/agent/watch-status` reports the pool live, frames arrive, a named task from `workers/agent-screen-pool/tasks/` runs, and the control channel (`api/agent-screen-control-drain.js`) round-trips a command. Check the worker `/health` JSON shows the casting entry.
6. Docs: update the README with the deployed service URL and observed behavior, `ARCHITECTURE.md` Agent Screen section status, `data/changelog.json`, `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] Both proof scripts exit 0.
- [ ] `gcloud run services describe agent-screen-pool ... --format='value(status.url)'` prints a URL; `curl -s <url>/health` returns `"ok": true` with `max` equal to `SCREEN_POOL_MAX`.
- [ ] A watched agent's screen shows live frames in a real browser with no console errors; `watch-status` reports the pool live.
- [ ] `grep -c SCREEN_WORKER_SECRET` on the API service description is non-zero.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Chromium cannot launch in the sandbox for the proof | Run it via the worker's Dockerfile, or on a Cloud Build step; the proof needs the real browser. |
| Setting the secret before the liveness gate ships | Do not. Follow the README order, otherwise cards claim "warming up" with no pool. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/742-plan-agent-screen-pool-deploy-and-verify.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `742-plan-agent-screen-pool-deploy-and-verify.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `workers/agent-screen-pool/README.md` (whole file)

~~~~markdown
# agent-screen-pool

On-demand live-browser caster for the [agent wall](https://three.ws/agents-live).

## Why this exists

Every agent on three.ws has a **live screen 24/7 at zero cost** already: the wall
streams each agent's real `agent_actions` activity from the database and renders
it as a live terminal. No browser required.

This worker adds the *optional* layer on top: a **real Chromium browser feed** for
the agents people are **actively watching right now**. It does not run a browser
per agent forever (that doesn't scale and isn't free): it casts only what's on
someone's screen, and tears each browser down when the last viewer leaves. Cost
scales with concurrent viewers, not with the number of agents.

## What the browser actually does

A watched agent isn't just screenshotted on a static page. It does **real,
multi-step web work** you can watch happen:

- **Task-driven mode (default).** For a normal agent the caster runs a real task
  from [`tasks/index.js`](./tasks/index.js): it navigates to a real public site
  (Wikipedia, Hacker News, MDN), types into a real search box, submits, waits for
  the real results to load, and reads them back. Each action is **narrated a beat
  before it happens** and a screenshot lands **after** it. That lead-then-land
  cadence ([`task-runner.js`](./task-runner.js)) is what makes it feel like the
  agent is thinking. Narration lines are written by the real LLM router
  (`/api/brain/chat`, free anon tier) so the words match the page, with the task's
  own declarative lines as a guaranteed fallback when the brain is unreachable.
  The plan is cached per task, so a fleet of casts costs one brain call per task.
- **Coin World Tour mode.** When the cast page is a walkable world exposing
  `window.__tour`, the caster instead walks the guide through the world's waypoint
  loop, narrating the platform's own launch feed at each stop.

$THREE is the only coin. The task library researches neutral public topics: it
never browses to, names, or transacts any token.

## How it works

```
viewer (browser)                  this worker                      three.ws API
-----------------                 ------------                     ------------
POST /api/agent/watch-intent ->   GET /api/agent/watch-wanted ->    { agents:[...] }
   (every ~20s per card)            (poll every POLL_MS)
                                  launch <= MAX_BROWSERS pages
                                  screenshot each every FRAME_MS
                                  POST /api/agent-screen-push  ->   Redis frame
viewer SSE  <-- /api/agent-screen-stream  <-------------------------  live frames
```

Authentication is a single shared secret, `SCREEN_WORKER_SECRET`, set on both the
API (the Cloud Run service env) and this worker. With it the worker may push
frames for **any** agent (it casts on viewers' behalf, it doesn't own the agents).

Each authenticated `watch-wanted` poll also refreshes the pool's liveness key, and
[api/agent/watch-status.js](../../api/agent/watch-status.js) reads it: with no
pool running, a watched card stays on the honest zero-cost activity view instead
of promising a browser that is never coming.

## Run it

```bash
cd workers/agent-screen-pool
npm ci
npx playwright install chromium      # local only; the Docker image bakes it in
SCREEN_WORKER_SECRET=<same-as-api> node index.js
```

Docker (the image the Cloud Run service runs):

```bash
docker build -t three-ws/agent-screen-pool .
docker run --rm -e SCREEN_WORKER_SECRET=<secret> three-ws/agent-screen-pool
```

The Dockerfile's base image tag and the `playwright` version in
`package-lock.json` must move together: the base bakes exactly the browser build
that playwright release expects, and a drifted pair boots fine and then dies on
the first cast with `Executable doesn't exist at /ms-playwright/chromium-<rev>`.

## Config (env)

| Var | Default | Notes |
| --- | --- | --- |
| `SCREEN_WORKER_SECRET` | none | **Required.** Must match the API. 16+ chars. |
| `BASE_URL` | `https://three.ws` | API + page origin. |
| `WANTED_URL` | `$BASE_URL/api/agent/watch-wanted` | Watch-set source. |
| `PUSH_URL` | `$BASE_URL/api/agent-screen-push` | Frame sink (wall convention). |
| `PORT` | unset | When set, bind the liveness endpoint. Cloud Run sets it. |
| `MAX_BROWSERS` | `6` | Concurrency cap = max simultaneous casts. |
| `POLL_MS` | `3000` | How often to reconcile the watch set. |
| `FRAME_MS` | `700` | Screenshot cadence per page (~1.4 fps). |
| `JPEG_QUALITY` | `58` | Frame quality vs. bandwidth. |
| `VIEWPORT_W` / `VIEWPORT_H` | `1280` / `720` | Cast viewport, in pixels. |
| `LEAD_MS` | `900` | How long a narration line leads its action. |
| `DWELL_MS` | `6000` | How long to hold on the result between task runs. |
| `CONTROL_URL` | `$BASE_URL/api/agent-screen-control-drain` | Control-channel drain (owner input). |
| `CONTROL_POLL_MS` | `250` | How often to drain queued owner input. |
| `MANUAL_HOLD_MS` | `2500` | How long the autonomous task stays paused after the last manual signal. |
| `TOUR_DWELL_MS` | `6500` | Pause per world-tour waypoint. |
| `TOUR_READY_MS` | `30000` | Max wait for a walkable scene to become ready. |
| `LAUNCH_FEED_URL` | `$BASE_URL/api/pump/launches?limit=8` | Tour commentary source (the platform's own launch records). |
| `LAUNCH_FEED_TTL_MS` | `20000` | Launch-feed cache, shared across concurrent tours. |

## Take the wheel (owner control)

The caster is not just an outbound screen: an agent's **owner** can drive its live
browser. Each tick this worker also calls `CONTROL_URL` for the agents it is
casting, learns whether a human holds the control lease, and dispatches their
queued input (mouse, drag, scroll, keyboard, navigation) into the real page via
[`control.js`](./control.js). While a human is driving, the autonomous task/tour
stands down (`isManual`) so the two never fight over the cursor, and resumes once
the lease lapses. Input is sanitized and SSRF-guarded on the API boundary; the
dispatcher re-clamps coordinates and re-guards navigation as defense in depth. See
[docs/agent-screen-control.md](../../docs/agent-screen-control.md) for the full
channel and safety model.

## Liveness

With `PORT` set the worker serves one JSON endpoint on `/`, which is both the
Cloud Run startup probe and the ops view of the pool:

```json
{ "ok": true, "worker": "agent-screen-pool", "bootAt": "...", "baseUrl": "https://three.ws",
  "max": 6, "casting": [{ "agentId": "...", "name": "...", "mode": "task", "task": "hn-scan" }] }
```

## Where it runs

A long-lived Cloud Run service, built and deployed by
[`cloudbuild.yaml`](./cloudbuild.yaml) in one submit (build, push, deploy):

```bash
gcloud builds submit workers/agent-screen-pool \
  --config workers/agent-screen-pool/cloudbuild.yaml \
  --region us-central1 --project aerial-vehicle-466722-p5
```

It deploys with `--no-cpu-throttling` (the reconcile loop must keep ticking
between probes), `--min-instances=1` and `--max-instances=1`: two instances would
both claim the same watched agents and double-push frames. Budget ~350 MB per
concurrent page, so raise `--memory` alongside `MAX_BROWSERS`.

The shared secret lives in Secret Manager as `screen-worker-secret` and is mounted
by the deploy step. The API side must carry the same value, and the order matters:

1. Deploy the API image first, so the running revision carries the pool-liveness
   gate in [api/agent/watch-status.js](../../api/agent/watch-status.js).
2. Then hand the API the secret (config-only update, merges into the env set):

   ```bash
   gcloud run services update three-ws-api --region us-central1 \
     --project aerial-vehicle-466722-p5 \
     --update-secrets=SCREEN_WORKER_SECRET=screen-worker-secret:latest
   ```

3. Then submit the build above.

Setting the secret on an API revision that predates the liveness gate would make
watched cards claim "warming up" with no pool running, which is the exact thing
the gate exists to prevent.

Any other always-on container host works the same way (one process is plenty).
There is no GitHub Actions path: this repo does not use GitHub Actions.

## Proof

```bash
node scripts/agent-screen-pool-proof.mjs
```

Runs the real worker against a real local server speaking the production wire
contract and asserts the whole core path: authenticated polling, real JPEG frames
from real Chromium, narration leading the screenshot that lands after it, the
control drain, the liveness endpoint, and teardown once nobody is watching. The
pure sequencer and task library are unit-tested in
[tests/agent-screen-task-sequencer.test.js](../../tests/agent-screen-task-sequencer.test.js).
~~~~

