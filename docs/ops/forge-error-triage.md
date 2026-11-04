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
- **Bursts of `malformed response` on `model-trellis`** (188 on 2026-10-28 to
  11-04, all `GET /tasks/<id>` answered 503 after about 86s) are a liveness
  kill, not a bad payload. `to_glb` runs xatlas's UV unwrap, which holds the
  GIL, so while it runs the event loop cannot answer `/health`; once the probe
  (60s period, 3 failures) gives up, Cloud Run kills the instance and every
  poll in flight on it fails. Over 1,633 completed jobs that week, every kill
  was at 212k or more decimated faces (up to 488k), because a fixed `simplify`
  fraction let a 1.3M-face raw extraction through at 330k. The worker now
  raises `simplify` just enough to keep the bake at or under `MAX_BAKE_FACES`
  (150k, above the p90 of 128k) and logs `simplify X -> Y to stay within the
  bake budget` when it does
  ([workers/model-trellis/request_policy.py](../../workers/model-trellis/request_policy.py)).
  A kill burst after that ships is a new cause: read the instance's last
  `After remove invisible faces` line before the `LIVENESS` message. It was a
  hang, not a GPU OOM, so the fix is a budget rather than a 4xx. The
  `zero-size array` crash and the `hunyuan3d-21-rtx` errors had no occurrence
  in the same window.
- **`rembg matte failed, using original image`** on `model-trellis` is the
  optional pre-matte degrading gracefully; the job still completes. In
  `model-triposg` the matte is not optional: photos are cut out by the
  sibling `rembg-service` (`birefnet-general-lite`, which replaced the
  non-commercial RMBG-1.4). An unreachable service raises `MatteUnavailable`,
  which stays a worker fault so the platform fails over to the next lane
  instead of generating from an unmatted photo; an empty matte is the
  caller's input problem and comes back as `InputImageError`.
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
