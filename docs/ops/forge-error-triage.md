# Forge error triage

Answering "what is actually failing in 3D generation, and how often?" from the
outcome ledger, without hand-writing SQL against production.

```bash
npm run forge:errors                          # last 7 days, top problems first
npm run forge:errors -- --days 30
npm run forge:errors -- --days 7 --json       # machine-readable, same numbers
npm run forge:errors -- --class lost_task     # every lane, step and sample in one class
npm run forge:errors -- --include-recovered   # also rank attempts that failed over
npm run forge:errors -- --include-internal    # count catalog-seeder and benchmark rows too
npm run forge:errors -- --reveal              # full messages and prompts (redacted by default)
```

Read-only: the script ([scripts/forge-error-report.mjs](../../scripts/forge-error-report.mjs))
runs SELECTs against `forge_creations` for this window and the one before it, and
writes nothing. The counting, wording and redaction live in
[api/_lib/forge-operator-report.js](../../api/_lib/forge-operator-report.js),
which `npm run forge:funnel` and `/forge-funnel` share. On production
(2026-11-27, 7 days) it answers in about 1 second.

Exit status: `0` printed, `1` the `--class` asked for is not in the window, `2`
`DATABASE_URL` is not set, `3` the database did not answer. A missing or
unreachable database prints what to do and no stack trace.

## One definition across every Forge report

`forge:errors`, `forge:funnel` and the `/forge-funnel` board count the same
thing, and each prints the definition at the top (`How this counts`):

- **request**: one generation someone asked for, a `forge_creations` row that did
  not fail over to another lane, platform rows left out.
- **success**: finished requests over finished plus failed. Jobs still in flight
  count as neither, so a busy minute never reads as a failure spike.
- **failure**: a request whose last attempt failed. An attempt that failed over
  is "recovered"; its successor carries the outcome.
- **attempt**: every finished or failed row, failed-over ones included. Lane
  tables count attempts, and their `lost` column counts requests.
- **platform rows**: catalog-seeder and quality-benchmark rows (`internal`, or
  listed in `forge_seed_jobs`), left out everywhere unless `--include-internal`.
- **public lane stats**: `/api/nvidia/stats` counts attempts per lane over every
  row, platform rows included, so it reads slightly above the lane table here.
- **time**: rolling windows ending now, days bucketed in UTC. The previous window
  is the same length immediately before it.

Measured on production 2026-11-27 over 7 days, both reports said 896 requests,
833 finished, 63 failed, 93.0% success, and the funnel's per-lane `lost` column
added up to the same 63. Fixed-row tests in
[tests/forge-operator-reports.test.js](../../tests/forge-operator-reports.test.js)
hold that agreement, the UTC day buckets, and in-flight-is-not-failure in place.

## Not in these numbers

A request refused before a job existed (sign-in required, throttled, image
rejected, reference image or lane unavailable) never reaches `forge_creations`.
No table records it. Its only record is the Cloud Run request log, which
`npm run forge:funnel -- --requests` reads and buckets by status (see
[forge-funnel.md](forge-funnel.md)). Both reports say this at the top, because a
healthy job table is not a healthy product.

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

## The stats look fine but users say it is broken

Every number above starts at a `forge_creations` row, and so does the lane
success rate on `/api/forge?health=1`. A request that ends before a job exists
writes no row: refused at sign-in, rejected input, a credit or region gate, the
platform rate limiter, the reference image painter refusing, the multi-view
step failing, or a lane refusing the submit itself. On 2026-11-26 the lane rate
read 93% while people reported that generation was broken: the requests that
failed before a lane were in no count at all, so neither this report nor the
health sensor moved.

Those endings are counted separately, by `observeForgeSubmit` in
[api/_lib/forge-prejob.js](../../api/_lib/forge-prejob.js), which wraps both
`POST /api/forge` and `POST /api/gpt-forge`. One event per request: the stage it
died at, a cause code (the response's `error`), the provider that refused when
the failure happened inside provider work, the HTTP status, and the wait the
response stated. No prompt text and no identifiers. Recording is
fire-and-forget with a 1.5 second ceiling, so a store outage never changes what
the person gets back.

Where to look, in order:

1. **Health payload.** `curl -s https://three.ws/api/forge?health=1 | jq .pre_job`
   gives `last_hour` and `last_24h`, each with `accepted`, `jobs_created`,
   `failed_before_job`, `sign_in_refused`, `by_stage`, `by_cause` (sorted),
   `by_provider`, `avg_stated_wait_s`, and the three rates. `metrics` beside it
   carries `success_rate_scope` (what the lane rate counts) and
   `end_to_end_success_rate`. The block is omitted when the deployment has no
   counter store, so its absence means "not measured", not "zero".
2. **The text reports.** `npm run forge:errors` and `npm run forge:funnel` both
   print a "Before a job existed" section and an end-to-end line beside the lane
   rate. They read the Redis counters directly when the shell has the Upstash
   env, otherwise the public health payload (override with `FORGE_HEALTH_URL`).
   Production's Redis is on a private address, so from a devbox the reports use
   the health payload.
3. **Logs, per request.** Every ending logs one line,
   `jsonPayload.evt="forge_submit"`, with `outcome`, `stage`, `cause`,
   `provider`, `http_status`, `retry_after_s`. Showcase seed jobs log with
   `internal: true` and are never counted.

The stages, in the order a request meets them: `sign_in`, `input`, `access`
(credit, pass or plan gates), `rate_limit` (the platform limiter), `image_check`,
`gate`, then the provider work the handler marks as it goes: `direction`
(prompt rewrite), `reference` (painting the image a text prompt needs),
`views` (the multi-view turnaround) and `submit` (a lane refusing the job). A
provider's own 429 inside the work counts at the stage where it happened, not
as `rate_limit`.

The rates:

- **lane success** = finished jobs over terminal jobs. What the 93% was.
- **pre-job failure** = requests that ended before a job over requests accepted
  past sign-in.
- **end-to-end success** = (models delivered in the response + jobs created ×
  lane success) over requests accepted past sign-in. This is the number a
  person experiences. A lane rate in the 90s next to an end-to-end rate far
  below it means the breakage is upstream of the lanes: read `by_stage` and
  `by_cause` before touching any lane.

The counters cover 24 hours (five-minute buckets for the last hour, hourly
buckets for the day). Anything older is only in the logs.

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

Real output, production, 2026-11-27 (definitions header and blind-spot note
trimmed, database host elided):

```
Top problems by requests lost (change against the 7 day(s) before)
  1. bad_input_image: 55 (87.3% of ranked), previously 1244 (-1189), worst lane trellis_selfhost x28
     input image could not be fetched or decoded
     e.g. image source tmpfiles.org is not a decodable image (UnidentifiedImageError)
  2. other: 8 (12.7% of ranked), previously 45 (-37), worst lane (not recorded) x8
     internal error (ref <id>)
     e.g. internal error (ref 44752d5686c4)

                            this window  previous
  ------------------------  -----------  --------
  requests                          896      2409
  finished                          833       803
  failed (lost)                      63      1606
  recovered by failover              23       521
  still in flight                     0         0
  success                         93.0%     33.3%
  platform rows (left out)          137       749

By day (UTC): 2026-11-20 4, 2026-11-21 1, 2026-11-22 24, 2026-11-23 3, 2026-11-24 2, 2026-11-25 13, 2026-11-26 12, 2026-11-27 4
By lane: trellis_selfhost 28, triposg 26, (not recorded) 8, pixal3d 1
By step: image 55, (not recorded) 8
```

- **Top problems** come first: the three causes that lost the most requests,
  each with its count in the previous window and the change. Messages that
  differ only by an id, a byte count or a duration are one cause.
- `bad_input_image` was 87% of this week's losses and 1,244 the week before. It
  is the caller's photo failing to fetch or decode (here, a link to a temporary
  file host that served something other than an image), not a lane fault.
- `internal error (ref <id>)` is the MCP servers' sanitized answer to a
  database or internal error inside a tool call
  ([api/_lib/mcp-error-sanitize.js](../../api/_lib/mcp-error-sanitize.js)).
  These 8 rows have no lane recorded. `--class other` lists their refs (refs are
  not redacted); the `tool_error` log line whose `log_id` matches a ref has the
  stack.
- `--class <id>` prints every lane, step, first and last seen, and redacted
  sample messages for one cause.

Older output, production, 2026-08-14, before the top-problems layout:

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
  in-memory task state. `model-trellis` heartbeats each live task's durable
  record every 30s and declares it orphaned after 180s without one, writing
  `task orphaned: its runner instance stopped mid-job (restart or out of
  memory); retry the request`
  ([workers/model-trellis/instance_health.py](../../workers/model-trellis/instance_health.py)).
  `model-hunyuan3d` and `model-triposg` still use the older reaper that writes
  `task orphaned: no progress within 30 minutes` after `_PENDING_TTL_SECS`
  (1800s) in their `main.py`. On NVIDIA it is
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

## Privacy

Error messages and prompts are what callers typed or linked, so the report
redacts them by default: a URL keeps only its host (`https://host/...`), and
emails, wallet addresses and IP addresses become `<email>`, `<address>` and
`<ip>`. `--json` carries the database host, never its credentials. `--reveal`
shows full messages and prompts when you need them for a specific fix; do not
paste revealed output into a public channel.

## What the page tells the person

The ledger above is for us. What the person sees when a request fails comes
from one copy map, [src/forge-errors.js](../../src/forge-errors.js), used by
both Forge pages (`/forge` and the studio) and every tool on the result panel
(auto-rig, stylize, split into parts, optimize, game-ready), for submit, poll,
upload and download failures.

```bash
npm run forge:error-codes              # every code a Forge endpoint can return: statuses, files
npm run forge:error-codes -- --missing # only codes with no copy (exits 1 if any)
npm run forge:error-codes -- --json
```

The inventory ([scripts/forge-error-codes.mjs](../../scripts/forge-error-codes.mjs))
reads the handler source statically: `api/forge.js`, `api/forged.js`,
`api/forge-*.js`, `api/forge/*.js`, `api/forge-off/*.js`, the
`api/_lib/forge-*.js` helpers and `api/_lib/require-three.js`, plus the shared
envelope codes from `api/_lib/http.js` and `api/_lib/creator-account.js`.
It recognizes `error: 'code'` body literals, `error(res, NNN, 'code')` helper
calls, `code: 'code'` on thrown errors, and `(…, NNN, 'code')` pairs. The
provider webhook and `api/gpt-forge.js` (its own copy layer) are not scanned.

Rules the map follows, and [tests/forge-error-copy.test.js](../../tests/forge-error-copy.test.js)
enforces:

- **Every extracted code has an entry.** Add a new `error: 'code'` to a Forge
  handler without copy and the guard fails, naming the code. Add the entry to
  `FORGE_ERROR_COPY` (a `title`, a `what` sentence, a `todo` sentence, `retry`
  of `now`, `wait` or `never`, and the `action` the panel offers).
- **The server's `message` is never shown.** It can carry provider output
  (a vendor name, a URL with a token, a stack). Two exceptions are screened:
  the poll's masked `status: 'failed'` sentence, and our own validation text on
  `invalid_prompt` / `invalid_options`. Both pass through `isSafeServerText()`,
  which rejects URLs, hosts, IPs, stack frames, key shapes, markup and vendor
  names, and fall back to map copy when they fail.
- **An unknown code still says something true and actionable** and carries a
  reference: the server's `ref` correlation id when there is one, otherwise
  `code/status at HH:MM UTC`. Ask a person who reports a failure for that
  reference, then match it in the logs (`npm run logs`) or the ledger above.
- **The server keeps provider text out of the body too.** When a provider
  fails while starting a job, `api/forge.js` and `api/gpt-forge.js` answer
  `invalid_key`, `insufficient_credits` (own key), `generation_failed` and
  `rig_failed` through `forgeFailureBody()`
  ([api/_lib/forge-public-error.js](../../api/_lib/forge-public-error.js)):
  fixed copy plus a 12-character `ref`, with the raw provider error logged once
  (credential shapes scrubbed) as `[forge] <code> ref=<ref>: <raw>`. A user's
  quoted reference finds that line with a `textPayload:"ref=<ref>"` filter on
  the `three-ws-api` service, using the log commands in
  [production-log-triage.md](production-log-triage.md).
  `tests/api/forge-public-error.test.js` fails if either handler relays
  `err.message` for those codes again.
- **The prompt and settings are always kept**, and every failure is announced
  through one visually hidden `role="alert"` region (`announceForgeError`),
  since the error panel is revealed by toggling a class.

## Credentials

The script reads `DATABASE_URL` from `.env.local`, then `.env`, then the shell,
in that order (same as [scripts/apply-migrations.mjs](../../scripts/apply-migrations.mjs)).
Without it, it exits 2 and prints the command that reads production's value off
the Cloud Run service:

```bash
# DATABASE_URL is a Secret Manager reference, so describe alone shows no value.
export DATABASE_URL="$(node scripts/read-service-env.mjs '^DATABASE_URL$' --raw)"
# The service you can read lives in the three-ws project:
export DATABASE_URL="$(GCP_PROJECT=three-ws node scripts/read-service-env.mjs '^DATABASE_URL$' --raw)"
```

If the database does not answer, it exits 3, names the host it tried, and prints
no report, because every number in it would have been empty rather than zero.

## Error codes a caller can see

These are the codes `POST /api/forge` answers with before or instead of a job. The ledger above covers failures that happen after a job exists.

- `401 sign_in_required`: the caller is not signed in on a create call ([api/_lib/creator-account.js](../../api/_lib/creator-account.js)). The body carries `sign_in_url` and the API key page `/dashboard/api-keys`. Not a fault: sign in or send `Authorization: Bearer <key>`.
- `401 invalid_key`: a bring-your-own-key provider (Meshy, Tripo, Rodin) rejected the key the caller supplied.
- `402 insufficient_credits`: the caller's own provider account is out of credits. A platform account running dry never shows this code; the caller sees the generic "temporarily unavailable" state and the free lanes take over.
- `403 region_restricted`: an engine whose licence excludes the caller's region was pinned. The body's `retry_backends` names engines that can serve the same request.
- `429 daily_limit_reached` and `429 rate_limited`: a throttle. The response states the wait (`retry_after` or `Retry-After`). Wait once, then retry.
- `501` or `503 backend_unconfigured`: the pinned lane has no worker or key on this deployment. Check `GET /api/forge?health=1` and pick a lane that reports `ok`.
