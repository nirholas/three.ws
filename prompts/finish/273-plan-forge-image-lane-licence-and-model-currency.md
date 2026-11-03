# Forge image lanes drop the non-commercial RMBG-1.4 matte and move off the retired Gemini image model

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/273-plan-forge-image-lane-licence-and-model-currency.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 66 of 100 inside the tier). **Area:** forge. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Forge is a paid product and its photo-to-3D rung removes backgrounds with `briaai/RMBG-1.4`, which ships under a non-commercial licence, inside `workers/model-triposg`. Separately the reference-image lanes default to `gemini-2.5-flash-image`, which the Gemini API marked deprecated with a shutdown of 2026-10-02 (the review could not confirm Vertex's own date). Both are silent failure or liability risks that need no owner decision. The same review lists several photo-to-3D reliability defects that were never root-caused.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `workers/model-triposg/main.py` loads `RMBG_WEIGHTS_DIR` (default `/weights/rmbg-1.4`) for image-mode background removal; README documents the weights as `briaai/RMBG-1.4`.
- `workers/rembg/rembg_policy.py` is a separate matting service with its own policy tests (`workers/rembg/test_rembg_policy.py`).
- `api/_lib/forge-reference-image.js:115`, `api/_lib/ai-image-lanes.js:174-177` and `api/_mcp3d/vertex-imagen.js` default `VERTEX_IMAGEN_MODEL` to `gemini-2.5-flash-image`.
- `api/input-photo.js` and `api/input-multiview.js` have a vercel.json function entry but no caller in `src/`, `pages/` or other `api/` files; a GET returns 405.
- `public/features/scan` copy ("No account for first scan", key `features_scan.no_account_for_first_scan`) contradicts the sign-in requirement of the scan flow.
- Cloud Run: `model-trellis` in us-east4 is a warm pinned instance that nothing routes to (idle capacity, config-only fix).
- Open errors named by the review and not root-caused: `zero-size array` and malformed-response failures in `model-trellis`, inference errors in `model-hunyuan3d-21-rtx`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```sh
grep -rn "gemini-2.5-flash-image\|gemini-3" api/_lib/forge-reference-image.js api/_lib/ai-image-lanes.js api/_mcp3d/vertex-imagen.js | head
grep -n "RMBG\|BiRefNet" workers/model-triposg/main.py workers/model-triposg/README.md | head
grep -rn "input-photo\|input-multiview" api src pages --include=*.js --include=*.html | grep -v "^api/input-" | head
gcloud run services describe model-trellis --region us-east4 --project aerial-vehicle-466722-p5 --format='value(spec.template.metadata.annotations)' 2>&1 | head -5
node scripts/forge-error-report.mjs 2>&1 | tail -20
```

Skip any task whose condition no longer holds.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Image model currency: make the model id a single resolved constant in one module used by `forge-reference-image.js`, `ai-image-lanes.js` and `vertex-imagen.js`. Probe Vertex with a minimal real `generateContent` call for `gemini-3.1-flash-image` (or the current GA successor listed in the Vertex model garden); if the call is allowed (Vertex billing hold may deny it, then use the Gemini API or the `threews` backend) set it as default and keep the old id as a one-step fallback tried only when the new id returns 404 or `model not found`. Test first in `tests/forge-reference-image.test.js`: a 404 on the primary falls through to the fallback, a 429 does not.
2. Licence: replace the RMBG-1.4 matte in `workers/model-triposg` with BiRefNet (MIT) or reuse the already-deployed `rembg-service`/`workers/rembg` matting over HTTP. Update the Dockerfile and weight bucket README, add a worker test beside `workers/model-triposg/test_app_contract.py` that the service starts with no RMBG weights, and remove the RMBG download from the build. If a clean replacement cannot be validated on a real photo set, remove TripoSG's photo rung from `api/_lib/forge-tiers.js` instead and document why.
3. Wire or delete the dormant input endpoints: if the Forge photo or multiview intake does not call `api/input-photo.js` / `api/input-multiview.js`, delete both files and their vercel.json entries (check `npm run check:rules` and `grep` for docs references first); otherwise wire the caller and add `tests/input-photo.test.js`.
4. Fix the scan page copy: find the true auth behaviour in the scan API (`grep -rn "scan" api/*.js | head`) and make the page text and its locale key match (edit `locales/en.json`, not the translated files, then queue the key for translation).
5. Idle capacity: remove the warm min-instances pin on `model-trellis` in us-east4 with a config-only `gcloud run services update --min-instances=0` (pre-approved), and record the revision.
6. Root-cause the `zero-size array` and malformed-response errors: pull the last 7 days of `model-trellis` and `model-hunyuan3d-21-rtx` error logs (`npm run logs` or `gcloud logging read`), reproduce with the failing input class in the worker's own test suite (`workers/model-trellis/`), fix, and add the regression test. If a failure is a GPU out-of-memory on large inputs, add input size guards that return a clean 4xx with a message.
7. Update `docs/ops/forge-error-triage.md` with the new lane facts and the changelog entry.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `grep -rn "gemini-2.5-flash-image" api` returns only the documented fallback constant.
- [ ] `grep -rln "RMBG" workers/model-triposg` returns nothing, and the worker test suite passes without RMBG weights.
- [ ] `ls api/input-photo.js api/input-multiview.js` either fails (deleted) or each has a test and a caller found by grep.
- [ ] `tests/forge-reference-image.test.js` fallback cases pass and failed before the change.
- [ ] `gcloud run services describe model-trellis --region us-east4` shows min instances 0.
- [ ] Scan page text and API behaviour agree (checked in a browser).
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Vertex denies the new image model (billing hold) | Use the Gemini API or the `threews` backend lane for the probe, keep Vertex as an env override, document the hold in the report. |
| Worker GPU image cannot be built locally | Test the pure-Python policy and contract layers in the worker test suite; leave the image build to Cloud Build config already in the worker directory. |
| Cannot validate a BiRefNet quality delta | Compare matte masks on the committed eval photos in `workers/avatar-reconstruction/eval/`; if no regression, ship; otherwise remove the TripoSG photo rung. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/273-plan-forge-image-lane-licence-and-model-currency.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `273-plan-forge-image-lane-licence-and-model-currency.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/ops/image-selfie-3d-review-2026-10-09.md` (section "5. Engineering follow-ups that need no owner decision")

~~~~markdown
## 5. Engineering follow-ups that need no owner decision

- Write forge reference images to GCS instead of the R2 dev endpoint.
- Swap TripoSG's RMBG-1.4 for BiRefNet (MIT), or remove TripoSG's photo rung.
- Unpin the warm `model-trellis` instance in us-east4. Nothing routes to it, so it is idle capacity. This is a config-only change.
- Root-cause the `zero-size array` and malformed-response errors in `model-trellis`, and the inference errors in `model-hunyuan3d-21-rtx`.
- Fix `/features/scan`, which says the first scan needs no account when sign-in is required.
- Wire `api/input-photo.js` and `api/input-multiview.js` to a caller, or delete them.
- `gemini-2.5-flash-image` is marked deprecated on the Gemini API (shutdown 2026-10-02). Vertex's own retirement date could not be checked while Vertex is denied. Move the image lanes to `gemini-3.1-flash-image` when access returns.
~~~~

### `docs/ops/image-selfie-3d-review-2026-10-09.md` (section "1. Photo to 3D: what fails")

~~~~markdown
## 1. Photo to 3D: what fails

### Weekly outcome, uploaded-photo jobs

| Week of | Jobs | Failed | Rate |
|---|---|---|---|
| Sep 14 | 4,065 | 649 | 16% |
| Sep 21 | 2,137 | 1,943 | 91% (Hunyuan3D and TRELLIS self-host down together) |
| Sep 28 | 1,576 | 345 | 22% |
| Oct 5 | 850 | 87 | 10% |

Over 30 days there were 10,085 jobs from 6,098 clients, and 3,075 failed (30%).

### Failure causes, last 8 days

| Cause | Jobs | Recovered by failover | Status |
|---|---|---|---|
| Hunyuan3D "internal error" | 80 | 56 | About 12 are dropped image fetches (fixed below). The rest are inference errors in `model-hunyuan3d-21-rtx`. |
| NVIDIA key rejected | 62 | 0 | Stopped on Oct 6. The key verifies today and the lane completes jobs again. |
| TripoSG "internal error" | 55 | 5 | **Fixed in code** (see below). Every TripoSG photo job was failing. |
| TRELLIS self-host orphaned task | 50 | 49 | Failover recovers almost all of them. Root cause: instances reclaimed mid-job. |
| TRELLIS v1 "internal error" | 39 | not recorded | Malformed worker responses and `zero-size array` errors in `model-trellis`. |
| NVIDIA NVCF request expired | 25 | not recorded | Vendor-side queue timeout. |
| Image host unreachable or 403 | about 20 | not recorded | Partly fixed (retry). See "Reference images" below. |

Latency is a second complaint. TRELLIS self-host takes 180 to 260 s at the median and 300 to 620 s at p90. Hunyuan3D takes about 90 s at the median.

### Fixed today (committed, ships with the next worker deploys)

- **Dropped image fetches are retried.**
  - Forge reference images are served from the public R2 dev endpoint (`pub-…r2.dev`). Cloudflare rate-limits that endpoint and it drops connections under load.
  - Each drop failed the job as an opaque internal error on TripoSG (18 log hits in 7 days) and Hunyuan3D (24).
  - `worker_security.fetch_remote_bytes`, which every worker vendors, now retries dropped connections, timeouts and 429/5xx answers twice, with backoff. Refusals and other 4xx answers stay final.
  - Covered by `workers/model-triposg/test_fetch_retry.py` and mirrored to all 20 workers.
- **TripoSG no longer crashes on a blank input.**
  - Upstream `load_image` returns an error *string* for a black or fully transparent image, and `prepare_image` then calls `.permute` on it.
  - That was 11 of the TripoSG failures in three days.
  - The worker now reports `input image unusable: …`, so bad inputs are distinguishable from faults.
- **Lane-order and worker docs corrected:** [image-to-3d.md](../image-to-3d.md), [avatar-reconstruction.md](../avatar-reconstruction.md) and [gcp-model-workers.md](gcp-model-workers.md).

### Reference images: the structural fix

The R2 dev endpoint is not meant for production traffic, and the retry only papers over that.
- `three.ws` DNS is hosted at the registrar, not on Cloudflare, so an R2 custom domain is not a one-click change.
- The better fix is to write forge reference images to the GCS bucket the workers already use: same project, same region, no rate limit, and no extra egress hop.
- Until then the retry absorbs the drops.
~~~~

### `docs/ops/forge-error-triage.md` (whole file)

~~~~markdown
# Forge error triage

Answering "what is actually failing in 3D generation, and how often?" from the
outcome ledger, without hand-writing SQL against production.

```bash
npm run forge:errors                       # last 7 days, ranked by class
npm run forge:errors -- --days 30
npm run forge:errors -- --days 7 --json    # machine-readable, same numbers
npm run forge:errors -- --class lost_task  # every message in one class
npm run forge:errors -- --include-recovered  # count failed-over attempts too
```

Read-only: the script ([scripts/forge-error-report.mjs](../../scripts/forge-error-report.mjs))
runs two SELECTs against `forge_creations` and writes nothing.

## Why this exists next to /api/healthz

`/api/healthz` already carries a Forge generation sensor
([api/_lib/ops/forge-health-sensor.js](../../api/_lib/ops/forge-health-sensor.js)),
and it answers a different question. It looks at a fixed **6 hour** window and
returns `unknown` below **15 attempts**, because it is tuned to page on a burst
of failures and must not page on a quiet afternoon. At forge's real volume that
window is regularly too small to judge at all, so "is generation healthy?" often
answers `unknown` while a failure class has been recurring all week. The sensor
also carries a stall check (`classifyForgeStall`) that this report cannot: a
failure upstream of the `forge_creations` row writes no rows at all, and a
ledger with nothing in it is exactly what a quiet afternoon looks like here.
`down` with `stalled: true` means generations have stopped *starting*, so read
the rest of the healthz payload (`object_storage` first) before opening this
report at all.

Triage needs the other question: over the last week, which class recurs most, on
which lane, and what does the message actually say? That is this report.

The sensor also pre-aggregates its reason in SQL with
`split_part(error, ':', 1)`. That is the cheap version of grouping and it only
holds while messages happen to lead with a stable prefix. It is not enough for a
ranking: `generation timed out after 41 minutes` and
`generation timed out after 63 minutes` are already two separate reasons under
it, and a vendor sentence with no colon becomes its own reason every single time.

## How the ranking groups

`forge_creations.error` stores whatever the lane said, verbatim
(`markFailed` in [api/_lib/forge-store.js](../../api/_lib/forge-store.js) clamps
it to 500 chars and nothing else). Storing the raw text is right: it is the only
forensic record of what a vendor or worker returned. Grouping on it is wrong,
because every message carries the specifics of its own failure (a prediction id,
a task uuid, a signed URL, a byte count, a minute count), so N instances of one
recurring failure count as N distinct classes and the ranking says nothing.

[api/_lib/ops/forge-error-class.js](../../api/_lib/ops/forge-error-class.js)
fixes that in two steps, and the report calls it in JS rather than in SQL for
exactly this reason:

1. **Normalize.** Lowercase, strip URLs, uuids, long hex/base58 ids, then counts
   and durations. Two occurrences of the same failure collapse to one string.
2. **Match a class.** Ordered most-specific first, so `task not found` reads as
   `lost_task` (the self-host lane lost the job) rather than as a generic 404.

Named classes: `timeout`, `lost_task`, `aborted`, `out_of_memory`,
`rate_limited`, `payment_required`, `unauthorized`, `upstream_5xx`,
`not_found_4xx`, `network`, `bad_input_image`, `bad_output_mesh`,
`content_filtered`, `storage`, `generic_failure`.

Anything unrecognized returns `other` keyed by its normalized text, so identical
unknown messages still group together instead of being force-fit into a named
bucket. An empty error is `none`. Same principle as
[api/_lib/forge-classify.js](../../api/_lib/forge-classify.js): high precision,
honest fallback, no invented buckets. Covered by
[tests/forge-error-class.test.js](../../tests/forge-error-class.test.js); when
you add a class, add its case there.

## A failed attempt is not always a lost generation

When a lane fails a job, the platform re-dispatches the original inputs to the
next healthy lane: on the attended poll ([api/forge.js](../../api/forge.js)) and,
long after every browser has stopped polling, on the finalizer cron
([api/cron/forge-finalize.js](../../api/cron/forge-finalize.js)). The successor
gets its own creation row and carries the request to completion, so the user
still gets a model.

The failed attempt keeps its own row, which is correct bookkeeping and used to be
actively misleading: every reader counted it as a user-visible failure. Measured
against production on 2026-08-14, over the prior 7 days: **3642 generations, 23
failures, and 13 of the 14 `trellis_selfhost` orphan failures had already been
recovered on `hunyuan3d` seconds later.** The top "failure class" was a class the
platform already handles.

So both failover paths now write `forge_creations.superseded_by` (the successor's
id) on the attempt they replaced:

- **This report** excludes recovered attempts from the ranking and the success
  rate, and prints how many it excluded. `--include-recovered` ranks them too,
  which is what you want when asking "which lane keeps needing a failover?"
- **The health sensor** excludes them from its window, so the failover machinery
  working can no longer degrade or page the `forge_generation` subsystem.

The column is forward-looking: it is set when a failover happens, and historical
rows were deliberately not backfilled, because reconstructing the link from
matching prompts and timestamps is a guess, and this ledger is the platform's
ground truth. Expect `recovered 0` on windows that predate it.

## Reading the output

Real output, production, 2026-08-14:

```
  generations 3642   done 3619   failed 23   still running 0
  of those failures, 0 were re-dispatched to another lane and finished there; 23 were lost
  success rate 99.4% (recovered attempts are not counted against it)

  rank  n     share   class                  worst lane            message
  1     19    82.6%   lost_task              trellis_selfhost×14   NVCF request not found or expired
  2     3     13.0%   timeout                nvidia×3              generation timed out after 45 minutes
  3     1     4.3%    other                  trellis_selfhost×1    internal error (ref 16485b338fc5)

  Top class: lost_task (lane lost the task (poll found nothing))
    19 of 23 failures (82.6%), lanes trellis_selfhost×14, nvidia×5
```

One class is 82.6% of all forge failures, and it is the same failure on two
unrelated lanes: the lane accepted the job and later could not find it. On
`trellis_selfhost` that is the worker's own orphan reaper (a Cloud Run instance
restarted mid-job and nothing resumes persisted tasks); on `nvidia` it is NVCF
expiring the request. Both are recoverable by failover, which is why the
recovery accounting above matters more than the raw count.

- **worst lane** is the `backend` column: which generation lane produced most of
  that class. A class concentrated on one lane is a lane problem; one spread
  evenly across lanes is a pipeline problem.
- **still running** counts rows in a non-terminal status inside the window. A
  large number here on an old window means jobs are never being finalized, which
  is a `forge-finalize` cron problem, not a generation problem.
- `--class <id>` prints every lane, path, first/last seen, and sample messages
  for one class. That is where you go before touching pipeline code.

## Where the failures come from

- **`timeout`** is usually written by the finalizer, not the lane:
  [api/cron/forge-finalize.js](../../api/cron/forge-finalize.js) marks a job
  `generation timed out after N minutes` once it has been open too long. A rising
  timeout class means jobs are being started and never returning, so check the
  worker's own logs for the same period ([gcp-logs.md](gcp-logs.md)).
- **`lost_task`** means the poll asked the lane for a job it does not know about.
  On a self-hosted worker that is a restarted or scaled-to-zero instance losing
  in-memory task state: the worker's reaper writes
  `task orphaned: no progress within 30 minutes` after
  `_PENDING_TTL_SECS` ([workers/model-trellis/main.py](../../workers/model-trellis/main.py),
  and the same reaper in `model-hunyuan3d` and `model-triposg`). On NVIDIA it is
  `NVCF request not found or expired`. Check the recovered count before treating
  a spike as user-visible.
- **`out_of_memory`** on a self-hosted lane is usually the GPU, not the prompt.
  Torch's caching allocator holds freed blocks in reserve and nvdiffrast
  allocates outside that cache, so an instance's usable VRAM only ever shrank:
  `model-trellis` served 1,189 generations on 2026-09-06 and then, after a
  restart on 2026-09-09, succeeded at exactly thirteen jobs and failed every
  single one after them with `Cuda error: 2[cudaMalloc(&m_gpuPtr, bytes);]` out
  of `postprocess_mesh`, while its health check kept passing and Cloud Run kept
  routing to it. The worker now hands a job's GPU memory back before it releases
  the inference semaphore, so a *recurring* OOM class on that lane is a new
  fault, not the old one.
- **A lane failing every job it accepts** is the shape to check `/health` for
  rather than the ledger. `model-trellis` retries a failed model load
  (`MODEL_LOAD_ATTEMPTS`, default 4, backing off from
  `MODEL_LOAD_RETRY_BASE_S`), and once that budget is spent the error latches
  and `/health` answers `503 ok:false` with `load_error` and `load_attempts`, so
  the instance is drained and recycled instead of staying resident. A latched
  load used to read as healthy.
- **`upstream_5xx`, `rate_limited`, `unauthorized`, `payment_required`** are all
  vendor-side and resolve on the vendor's dashboard or in the env, not in code.
  See [production-log-triage.md](production-log-triage.md) for the same
  distinction across the rest of the platform.

## Credentials

The script reads `DATABASE_URL` from `.env.local`, then `.env`, then the shell,
in that order (same as [scripts/apply-migrations.mjs](../../scripts/apply-migrations.mjs)).
Without it, it exits 2 and prints the command that reads production's value off
the Cloud Run service:

```bash
# DATABASE_URL is a Secret Manager reference, so describe alone shows no value.
node scripts/read-service-env.mjs '^DATABASE_URL$' --raw
```
~~~~

