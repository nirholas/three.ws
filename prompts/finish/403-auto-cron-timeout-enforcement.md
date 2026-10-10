# 403. Enforce the cron time budget that `maxDuration` only pretends to set

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate. Written by the evolve scout lane on 2026-10-10 from the measurements below.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write, git push or a production deploy, posting to an external channel, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. This order needs none of them until the ship.
- No mocks, no fake data, no placeholder stubs, no unfinished-work markers, no commented-out code.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before each commit, and commit finished work promptly.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.
- This order touches a shared function (`wrapCron` in `api/_lib/http.js`) that every one of 100 cron handlers calls. Change its *behavior* only in the way task 1 specifies (add a budget-and-clean-503 path); do not refactor anything else in that function. A mistake here breaks every cron, not one.

## Why this matters (measured 2026-10-10, 20:17 to 20:30 UTC, production on `5af439bc0`, revision `three-ws-api-00487-7mt`)

| Probe | Result |
|---|---|
| 24h error count, `three-ws-api`, `severity>=ERROR` | 21 lines of `The request has been terminated because it has reached the maximum request timeout.` This is Cloud Run's own ingress kill, not an application error; nothing in the handler ever ran a catch block for it. |
| Which URLs hit it | Mostly `/api/cron/x402-ring-leak-scan` (order 400's own target, unfixed version still in production), but also `https://three.ws/api/cron/forge-thumbnail-backfill` (2 hits, 2026-10-10 14:50 and 15:15 UTC) and `https://three.ws/api/news/image?url=...` (3 hits, all Reddit article URLs, 2026-10-10 15:15 UTC, likely collateral from the same CPU/connection pressure, not its own bug: `api/news/image.js` already wraps its fetch in a 6s `fetchModel` timeout). |
| `grep -rn maxDuration server/index.mjs api/_lib/http.js` | **Zero matches.** The export is never read anywhere in the server. |
| `grep -rl "export const maxDuration" api/` | **77 files** export it, 14 of them cron handlers, with values from 10s to 300s. Several handler comments do sizing arithmetic against it as if it were enforced, e.g. `api/cron/forge-thumbnail-backfill.js`: "8 models at concurrency 2 lands ~25-40s, inside maxDuration=120." |
| `server/index.mjs` | `server.requestTimeout = 0; server.headersTimeout = 65_000;` with the comment "SSE and other live streams work... Cloud Run enforces the real deadline." Deliberate for streaming routes, but it means every non-streaming route (crons included) has **no enforced ceiling at all** except Cloud Run's own ingress timeout, `--timeout 900` in `server/cloudbuild.yaml`. |
| `grep -rl "wrapCron(" api/cron/*.js \| wc -l` | **100 of 100** cron handlers go through `wrapCron` (`api/_lib/http.js`), which awaits the handler with no timeout, no `Promise.race`, no `AbortController`. |
| `api/_lib/render-glb.js` | One explicit timeout in the whole render path: `page.waitForFunction(..., { timeout: 15_000 })`. `page.setContent` and `page.screenshot` carry no explicit timeout, so puppeteer's own defaults (commonly 30s each) apply, uncapped by anything this codebase controls, and `getBrowser()` (chromium launch / first-run binary download) has no timeout either. |

Root cause: `maxDuration` was a real, Vercel-enforced per-function budget before the 2026-07-07 Cloud Run migration (CLAUDE.md stack notes). Nothing was wired to replace that enforcement, so every one of the 100 cron handlers (and dozens of regular API routes) now runs with a 900-second ceiling it was never sized for, and a hang anywhere inside one surfaces 15 minutes later as an undiagnosable "maximum request timeout" with no cron name, no elapsed time, and no heartbeat write, instead of the fast, typed, logged failure the code's own sizing comments assume. This is distinct from order 400 (that order fixes the ring-leak-scan handler's *own* unbounded wallet walk; this order fixes the fact that nothing would have caught it, or any of the other 99 cron handlers, in a bounded way even if it had misbehaved differently). It is also distinct from order 402 (gate/test health) and order 401 (vitest suite health).

## Step 0: re-derive the current state

    curl -s https://three.ws/api/version
    gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="three-ws-api" textPayload:"maximum request timeout"' --freshness=24h --project aerial-vehicle-466722-p5 --format='value(timestamp, httpRequest.requestUrl)' --limit=50
    grep -rn "maxDuration" server/index.mjs api/_lib/http.js
    grep -rl "export const maxDuration" api/ | wc -l
    grep -rl "wrapCron(" api/cron/*.js | wc -l
    grep -n "page.setContent\|page.screenshot\|waitForFunction\|setDefaultTimeout\|setDefaultNavigationTimeout" api/_lib/render-glb.js
    npx vitest run tests/http-db-unavailable-boundary.test.js

If `maxDuration` is now read somewhere in `server/index.mjs` or `wrapCron`, or the 24h log query shows zero `forge-thumbnail-backfill` / non-ring-leak-scan timeout hits across a fresh 24h window, re-check whether this already shipped before continuing; if so, verify each Definition of done line and close out instead of redoing the work.

## Tasks

1. **Give `wrapCron` a real budget.** In `api/_lib/http.js`, change the signature to `wrapCron(handler, { requireWriteCapacity = false, maxDurationMs } = {})`. Default `maxDurationMs` to `120_000` when the caller does not pass one (matching the most common declared `maxDuration` value today). Inside the function, race the handler against a timer:
   - Run `handler(req, res, ...rest)` as today.
   - In parallel, start a timer for `maxDurationMs`. If it fires *before* the handler settles AND `!res.headersSent && !res.writableEnded`, write the cron heartbeat as failed (reuse the existing `cacheSet('cron:heartbeat:' + cronName, ...)` call already in the function, with `ok: false` and a `timed_out: true` field), log `console.warn('[cron] ' + cronName + ' exceeded its ' + maxDurationMs + 'ms budget, answering 503 before Cloud Run's own timeout kills the connection')`, call the existing `sendOpsAlert` helper (already imported in this file) with a signature like `` `cron:timeout:${cronName}` `` so repeats dedupe, and answer `json(res, 503, { ok: false, reason: 'cron_timeout', cron: cronName, budget_ms: maxDurationMs })`.
   - The handler's own promise is **not** cancelled (Node cannot preempt arbitrary async work without an `AbortSignal` threaded through every I/O call inside it): only the HTTP response and the heartbeat are resolved early. State this limitation in a one-line comment at the race site so a future reader does not assume true cancellation. Attach a `.catch(() => {})` / a settled-state guard so the real handler's eventual resolution or rejection, once it does finish, never tries to write to an already-ended response or crash the process with an unhandled rejection.
   - If the handler settles first (the common case), clear the timer and behave exactly as today, with zero behavior change for every cron that finishes inside its budget.
2. **Wire the 14 crons that already declare `maxDuration`.** For each of the 14 files from `grep -rl "export const maxDuration" api/cron/*.js`, pass `{ maxDurationMs: maxDuration * 1000 }` (keep `requireWriteCapacity` where already present) into their `wrapCron(...)` call so their own declared budget becomes real instead of decorative. The other 86 cron files need no edit; they get the 120s default for free.
3. **Tighten the render pipeline that actually hung today.** In `api/_lib/render-glb.js`'s `renderOnce`, add explicit timeouts consistent with the existing `page.waitForFunction(..., { timeout: 15_000 })`: pass `{ timeout: 20_000 }` to `page.setContent` and `{ timeout: 15_000 }` to `page.screenshot`. Add a timeout guard around `getBrowser()`'s cold-launch path too (the chromium binary download on a cold container has no cap today) using the same `AbortController`/`Promise.race` idiom this codebase already uses in `fetch-model.js`, capped at 30s. Every one of these must reject with a clear `Error` message naming which stage timed out (`'render timed out at setContent'`, etc.) so a future "maximum request timeout" investigation has something better than a blank 900s gap to read.
4. **Tests**, new file `tests/http-cron-timeout.test.js`: a handler that never resolves gets raced against a short `maxDurationMs` and the test asserts (a) the mocked response received the 503 `cron_timeout` body before the real handler settles, (b) the heartbeat cache write recorded `ok: false, timed_out: true`, (c) a handler that resolves well inside the budget is completely unaffected (status, body, and heartbeat identical to the pre-change behavior), (d) calling `wrapCron` with no `maxDurationMs` falls back to 120000. Each must fail against the pre-fix `wrapCron`. Add one assertion to `tests/http-db-unavailable-boundary.test.js` (or a new adjacent test) confirming the db-unavailable path still works unchanged now that `wrapCron`'s body has a race added around it.
5. **Docs.** Add a short section to `docs/ops/production-log-triage.md` right after the existing "x402 ring leak scanner" write-up (if order 400 already landed it) or as its own entry: "HTTP timeout with no cron context": explain that `maxDuration` is now enforced by `wrapCron`, that a clean `503 cron_timeout` with the cron name in the body replaces the old blank "maximum request timeout", and how to read the dedup'd ops alert signature `cron:timeout:<name>`.
6. **Changelog.** This is a reliability fix users feel as crons that fail fast and recover instead of silently wedging for 15 minutes; add a `data/changelog.json` entry tagged `infra` in plain language, then `npm run build:pages`.

## Definition of done

- [ ] `grep -n "maxDurationMs" api/_lib/http.js` shows the new parameter and the race logic.
- [ ] `grep -c "maxDurationMs:" api/cron/*.js` sums to 14 (one per file that already declared `maxDuration`), and each of those 14 files' value matches its own `maxDuration * 1000`.
- [ ] `npx vitest run tests/http-cron-timeout.test.js tests/http-db-unavailable-boundary.test.js` exits 0, and `tests/http-cron-timeout.test.js` failed against the pre-fix `wrapCron`: write the test first, run it red, paste the red output into the report, then make it pass.
- [ ] `npm run test:core` shows no new failures versus the step 0 baseline (record both counts; order 401 owns any pre-existing red).
- [ ] A local run proves the race fires: `npm run dev` on a free port (not 3000), then a temporary cron route whose handler awaits an unresolved promise, hit with `curl -s -o /dev/null -w '%{http_code} %{time_total}\n'` and a short `maxDurationMs` override, returns `503` in close to the budget, not instantly and not after a long hang. Delete the temporary route before committing; do not leave scratch routes in `api/cron/`.
- [ ] `grep -n "timeout" api/_lib/render-glb.js` shows the new `setContent` and `screenshot` timeouts alongside the existing `waitForFunction` one.
- [ ] `npm run check:rules -- --paths <files you touched>` exits 0; `npm run build:pages` exits 0.
- [ ] A dated row in `prompts/finish/_context/production-100-OWNER-ACTIONS.md` names the ship command (`npm run deploy:gcp:full`) and the post-deploy check: the 24h log query in Step 0, re-run after the deploy window, shows `maximum request timeout` lines only for crons that are themselves still over budget (cross-reference against order 400's status), never a blank one with no corresponding `cron_timeout` heartbeat.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| "Can't truly cancel the handler, so the fix feels incomplete" | Correct and intentional; Node has no generic preemption. The fix converts an undiagnosable 900s black hole into a fast, logged, typed failure with the cron's name attached, which is the realistic, honest scope. Say this plainly in the report; it is not a gap to close in this order. |
| Production is 45 commits behind `main`, so the fix cannot be proven live | Prove it locally (the temporary route in the Definition of done) and against the existing test suite; the deploy is the owner's one step, recorded in OWNER-ACTIONS. |
| Changing `wrapCron` feels risky because 100 handlers depend on it | That is exactly why the change must be additive-only: a handler that finishes inside its budget (the overwhelming common case) must see byte-identical behavior. Prove this with task 4(c) before touching anything else. |
| Unsure whether a given cron's real workload fits in the 120s default | Do not retune individual crons' budgets in this order beyond the 14 that already declared one; a cron that turns out to need a larger explicit `maxDuration` is a one-line follow-up once the mechanism exists, not a reason to widen this order's scope. Note any crons you suspect need one in the report. |
| Unrelated test files are already red | Baseline them in Step 0 and require no new failures; order 401 owns the suite. |
| `render-glb.js` timeouts change rendered output somehow | They do not; they only bound how long a stalled render is allowed to wait before failing with a clear error instead of hanging. A render that completes well inside the new caps (the overwhelming common case per the file's own ~3-6s sizing comment) is unaffected. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff, e.g. `fix(http): make wrapCron answer a clean 503 at its own time budget instead of hanging until Cloud Run's 900s kill`.
3. If every line passes, delete this file in that same commit (`git rm prompts/finish/403-auto-cron-timeout-enforcement.md`) and append a dated entry to `prompts/finish/_context/production-100-PROGRESS.md` with the commit SHAs. If a line cannot pass in this session, leave the file, log which line remains and who owns it.
4. Final report, in this order: what Step 0 measured; what changed (files with commit SHAs); evidence per Definition of done line; the OWNER-ACTIONS row text; one-line judgment calls. No trailing questions.
