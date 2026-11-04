# Background generation and completion notifications

Forge generations are server-tracked to completion. You can start a generation
on [/forge](https://three.ws/forge), close the tab, and the platform finishes
the job, saves the model to your gallery, and tells you when it's ready.

## What the user experiences

- **Leave any time.** The generating panel says so explicitly. Navigating away
  or closing the tab does not lose the job.
- **Come back, pick up where you left off.** Returning to `/forge` within 30
  minutes resumes the live progress view for the in-flight job (honest elapsed
  timer included). The finished model also appears in the on-page gallery on
  any later visit.
- **Get notified.** Signed-in creators receive a notification when a
  generation finishes unattended: the bell inbox and Web Push fire with a link
  straight to the model, and an email goes out with a preview image. Failures
  notify too (bell and push only). Every channel has its own switch under the
  **Creations** category in the notification preference center. Anonymous
  users aren't left out: their browser resumes the job from local storage and
  the finished model is waiting in their gallery.

Attended completions never notify. If the result appeared on your screen, the
platform does not also push, email, or badge you about it.

## How it works

Three cooperating pieces:

1. **Client resume** ([src/forge.js](../src/forge.js)): after a job is
   submitted, its signed job token persists in `localStorage`
   (`forge:inflight`). On page load the forge resumes polling that token; all
   real state lives server-side, so a reload costs nothing. The record clears
   on completion, terminal failure, or cancel. The poll loop itself is built on
   [src/shared/resilient-poll.js](../src/shared/resilient-poll.js) (retry,
   visibility-wake, attempt-based budget), because a generation runs for minutes
   and on a phone the tab is backgrounded, the radio drops, and the edge answers
   the odd 502, none of which mean the job died. A connection we finally gave up
   waiting on throws with `kind = 'transport_lost'`, and that one case
   deliberately **keeps** the inflight record rather than clearing it, which is
   what makes the error's own "reopen /forge to pick it back up" true.

2. **Server-side finalizer** ([api/cron/forge-finalize.js](../api/cron/forge-finalize.js),
   every minute via Cloud Scheduler): sweeps `forge_creations` rows still at
   `status='generating'` after a 2-minute grace period. Rows whose job id is a
   GCP worker envelope (the async self-host lanes: TRELLIS, Hunyuan3D,
   TripoSG sketch) are polled directly on the worker, and NVIDIA NIM rows are
   polled too (the x402 lane stores the signed job token; browser free-lane
   rows store the bare NVCF request id). Finished jobs are materialized into
   durable storage with the exact same writer the browser poll uses
   (`materializeCreation`). Failures do not dead-end: a failed self-host job
   past the attended polling window (13 minutes, so a live browser's own
   failover is never raced) is redispatched unattended to the next healthy
   lane under the same hop cap as the attended path, and an expired NVCF
   request is resubmitted from the inputs stored on the row. NVIDIA NIM is the
   only text-to-3D lane, so a stalled NVCF poll has nowhere to fail over to:
   once the row is past the same 13-minute window it gets exactly one unattended
   resubmit (`decideNvidiaStall`), and an in-flight marker is written before the
   paid submission so a tick cut off mid-flight is never re-fired. A failed
   resubmit raises an ops alert (`console.warn` from this handler never reached
   Cloud Logging). A redispatched
   attempt is linked to its successor row (`forge_creations.superseded_by`,
   migration `20260814200000_forge_failover_supersede.sql`), so the outcome
   ledger records a recovery rather than a loss. Only a job with nothing left
   to try is marked failed, and the finalizer logs that it declined the
   failover (every alternative lane already attempted or cooling) rather than
   failing silently. Anything non-terminal after 45 minutes is marked failed
   as timed out, so no row can be orphaned at `generating` again. That reap
   (`reapExpiredRows`) is one bulk update that runs first on every tick,
   independent of the live-poll batch, so a batch filled by one unhealthy lane
   cannot keep other lanes' rows from being reaped. Reaping an NVIDIA row also
   cools the NIM submit breaker, so new text requests skip the lane that just
   timed out.

3. **Notifications** ([api/_lib/forge-notify.js](../api/_lib/forge-notify.js)):
   the finalizer, and only the finalizer, notifies. `forge_complete` and
   `forge_failed` are standard notification types in the `creations`
   preference category (defaults: in-app, push, email and the on-page
   companion avatar on; Telegram off; email only for completions). The
   `avatar` channel is delivered client-side by the corner companion
   (`src/notification-herald.js`), which walks on and says it out loud while
   the user is on the site; it can be muted per browser from its bubble.
   Email delivery uses the platform Resend pipeline and skips undeliverable
   placeholder addresses.

   **Developer webhooks are the one channel that ignores the attended /
   unattended split.** `forge.completed` fires from `materializeCreation`, the
   universal completion writer, so an API integrator learns every outcome
   whether or not a browser was watching. `forge.failed` fires from
   `notifyForgeFailed` instead, because this is the only place that can tell a
   terminal failure from a failover that is still running: `markFailed` also runs
   on the redispatch path, and telling a subscriber the job died while it is
   still running would be a lie. See [api-reference.md](api-reference.md).

## Self-host poll recovery (the "task not found" grace)

A self-host worker poll (`/tasks/:id` or `/jobs/:id`) can 404 when the durable
task record is not yet visible to the instance the poll load-balanced to: the
brief post-submit cross-instance window (workers run at high concurrency with no
session affinity), or a completion write racing the poll. The worker persists
each task's `queued` state to GCS before returning its 202 and re-reads GCS for
non-terminal records, so a 404 is almost never a real loss.

The router used to treat that first 404 as terminal, which made
`task not found on gcp service` the platform's single largest generation-failure
class (image→3D). Recovery now mirrors the NVCF path (never dead-end on a
recoverable signal): the GCP provider tags a 404 with `code: 'gcp_task_missing'`
([api/_providers/gcp.js](../api/_providers/gcp.js)) and the poll handler runs a
pure decision ([api/_lib/forge-selfhost-recovery.js](../api/_lib/forge-selfhost-recovery.js)):

1. **Store re-check**: if the creation row already materialized (`done` + a
   glb), a racing poll or the completion write beat us; resolve as complete.
2. **Grace window**: a job younger than `GCP_TASK_MISSING_GRACE_MS` (90s)
   reports `running` so the client keeps polling; the durable record resolves
   within seconds.
3. **Terminal**: past the window a still-missing task is genuinely orphaned;
   the failure surfaces and the existing lane failover redispatches to a healthy
   lane. Nothing here disables failover, it just stops firing it on transient
   404s.

## Generation success-rate health

Lane liveness ("can a worker serve right now?") is not the same as outcome
health ("are generations succeeding?"). A warm lane can still fail half its
jobs: the 404 burst above ran ~48% failure for days while every liveness probe
read healthy. The **Forge 3D generation** subsystem
([api/_lib/ops/forge-health-sensor.js](../api/_lib/ops/forge-health-sensor.js))
closes that: it reads `forge_creations` outcomes over a 6h window and reports the
success rate (`done / (done + failed)`; running/queued excluded, and so are
attempts that were re-dispatched to another lane, `superseded_by` set, so the
failover machinery working is never counted as loss), naming the
worst backend/path and top error class so a page is actionable. It rolls into
`/api/healthz`, `/status`, and the uptime-cron escalation. States: `ok` ≥ 85%,
`degraded` 60 to 85%, `down` < 60%, `unknown` below 15 finished generations
in-window. This is the forge twin of the x402 settlement-success sensor.

The rate can only judge generations that got far enough to write a
`forge_creations` row, so `classifyForgeStall` answers the other question: has
the forge stopped **starting** generations? A failure upstream of that row (on
2026-09-07, object storage rejecting the reference-image upload every lane
needs) writes no rows at all, and no rows otherwise reads as a quiet hour. A
lane averaging at least 3 starts an hour that has started nothing for 45 minutes
reports `down` with the hint to check `object_storage` in the same payload
first, because that shape is a shared dependency rather than a lane fault.

## Operational notes

- The finalizer needs `CRON_SECRET` (the shared fail-closed cron gate,
  `api/_lib/cron-auth.js`), `DATABASE_URL`, the
  R2 `S3_*` storage vars, and `GCP_RECONSTRUCTION_KEY` to poll workers. With
  no worker key it still reaps timed-out rows.
- Batch size is 25 per tick (`FORGE_FINALIZE_BATCH` overrides), swept 8 rows at
  a time (`FORGE_FINALIZE_CONCURRENCY`) so one slow lane costs the tick its
  slowest poll, not the sum of them. Ticks are idempotent and safe to overlap.
- Cron handlers run under `wrapCron`'s time budget (60 s here, 120 s for the
  web-variant cron): past it the request answers `503 { reason: 'cron_timeout' }`,
  writes the heartbeat as timed out and raises one deduplicated ops alert,
  instead of hanging until Cloud Run's 900 s kill.
- The response body reports `{ enabled, reaped, swept, done, failed, failed_over,
  resubmitted, timed_out, still_running, unpollable, elapsed_ms }` per tick, so a
  quick manual hit shows queue health at a glance.
- A finished mesh also gets a phone-sized delivery variant (`buildWebVariant`,
  meshopt geometry plus WebP textures capped at 2048 px) written straight after
  materialization, to a second key, so the stored original is never touched and
  `download` and every API consumer keep the full-resolution mesh. Meshes forged
  before 2026-09-04 are backfilled newest-first by
  [api/cron/forge-web-variants.js](../api/cron/forge-web-variants.js) (every 10
  minutes, `FORGE_WEB_VARIANT_BATCH` meshes per tick, default 6). A row whose
  variant would not be smaller keeps `web_glb_url` null, and every reader already
  treats null as "serve `glb_url`".

Related: [3d-pipeline.md](3d-pipeline.md) for the generation lanes themselves,
and the notification preference model in
[api/_lib/notify-prefs.js](../api/_lib/notify-prefs.js).
