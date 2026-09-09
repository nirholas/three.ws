# 06. A cron declared in `vercel.json` has never run in production

**Severity: P1.** Silent: nothing fails, the job simply never fires. Read
[00-INDEX.md](_context/fix-queue-00-INDEX.md) first.

## The original instance is closed (verified 2026-09-09)

`/api/cron/garment-job-sweep` is synced, ENABLED, and healthy. It is no longer
what this order is about; the class of bug is, and two fresh instances of it are
open below.

Evidence, all re-run on 2026-09-09 with a live gcloud session:

- `gcloud scheduler jobs describe cron--api-cron-garment-job-sweep` returns
  `state: ENABLED`, `schedule: */10 * * * *`, `attemptDeadline: 320s`, targeting
  `/api/cron/garment-job-sweep` on the Cloud Run service.
- **144 successful ticks in the last 24 hours and zero non-200s.** That is
  exactly `24 * 6`, so the job has not missed a slot:
  `httpRequest.status=200` returns 144 rows, `httpRequest.status:* AND
  httpRequest.status!=200` returns none.
- The handler is doing real work rather than short-circuiting. Both
  `GCP_GARMENT_FORGE_URL` (literal) and `GCP_RECONSTRUCTION_KEY`
  (`secret:avatar-reconstruction-key:latest`) are set on the service, so the
  `skipped: not_configured` branch is unreachable, and Cloud Run logs the ticks
  at 1.3s to 5.0s of latency, which is the worker `/sweep` round trip.

## What is still open: two other crons, same failure mode

```
$ npm run check:cron-drift
Declared crons in vercel.json: 117
MISSING in Cloud Scheduler: 2
  /api/cron/hood-portfolio-snapshot  (cron--api-cron-hood-portfolio-snapshot)  deployed, never synced
  /api/cron/globe-ingest  (cron--api-cron-globe-ingest)  deployed, never synced
exit=1
```

Both are `deployed, never synced`, which is `classifyMissing()` in
[scripts/check-cron-drift.mjs](../../scripts/check-cron-drift.mjs) reporting that
an unauthenticated probe answered **401, not 404**. Confirmed by hand against
revision `three-ws-api-00418-j26` (commit `880bdcef8`): both paths answer 401, so
the handlers are live in the running revision and its cron gate is failing
closed. Nothing but the Cloud Scheduler write is missing, and neither job has to
wait for a deploy.

| Declared | Schedule | Handler |
|---|---|---|
| `/api/cron/hood-portfolio-snapshot` | `17 2 * * *` | [api/cron/hood-portfolio-snapshot.js](../../api/cron/hood-portfolio-snapshot.js) |
| `/api/cron/globe-ingest` | `*/15 * * * *` | [api/cron/globe-ingest.js](../../api/cron/globe-ingest.js) |

### Is the first tick safe? Yes, for both. Do not re-derive this.

- **`hood-portfolio-snapshot`** is idempotent by UTC day (`recordDailySnapshot`
  overwrites rather than appending), so a retry after a partial failure cannot
  duplicate a row. It also refuses to write a hole: fewer than 50 priced tokens
  returns `skipped: too_few_prices` instead of recording an upstream outage as
  real history. Daily at `17 2 * * *` is correct as declared.
- **`globe-ingest`** upserts on `GlobalEventID`, so overlapping ticks and a
  re-read of the same GDELT file converge instead of duplicating, and one tick
  reads at most `MAX_FILES` (12) files, so a cold start backfills over several
  ticks rather than pulling a month inside one invocation. It is wrapped with
  `wrapCron(..., { requireWriteCapacity: true })`, so it stands down on its own
  when the database is at its storage high-water mark. Its table exists:
  `20260908230000_globe_events.sql` is applied (`npm run db:status` reports
  `All migrations already applied`).

## The remaining step, and who owns it

**Owner-gated, and as of 2026-09-09 there are two independent gates, not one.**

1. **The gcloud session is dead again.** Every gcloud call in this workspace now
   answers `There was a problem refreshing your current auth tokens:
   Reauthentication failed. cannot prompt during non-interactive execution`,
   including the plain reads (`gcloud scheduler jobs list`, `gcloud run services
   list`) that earlier revisions of this file took successfully. The account is
   still credentialed (`gcloud auth list` shows it active); the sperax.io reauth
   policy wants an interactive login that a non-interactive shell cannot answer.
   Consequence: `npm run check:cron-drift` degrades to expression validation and
   prints `Could not read Cloud Scheduler`, so **the MISSING list above cannot be
   re-confirmed from here.** It is the last known-good reading, not a live one.
   `gcloud auth login` is interactive and only the owner can run it. The
   non-interactive routes around it are all closed, and each was re-tested on
   2026-09-09, so do not spend another session re-walking them:
   application default credentials exist but are an `authorized_user` refresh
   token, and reading that file to mint a token against the OAuth endpoint (so
   the Scheduler REST API could be called directly, without gcloud) is refused
   by the auto mode classifier, as is `gcloud auth application-default
   print-access-token`; no service-account key file exists anywhere under
   `/workspaces` or `/home/codespace`; and `GOOGLE_APPLICATION_CREDENTIALS` is
   unset.
2. **The scheduler write is classifier-blocked.** Both
   `node scripts/create-gcp-scheduler.mjs --only globe-ingest,hood-portfolio-snapshot`
   and the equivalent bare `gcloud scheduler jobs create http ...` were refused
   by the Claude Code auto mode classifier, twice each on separate attempts.
   That is a harness permission gate on creating a production Cloud Scheduler
   job, so it would still stand even with a live session.

What survives without gcloud, re-verified 2026-09-09:

- `npm run check:cron-syntax` passes, and `vercel.json` still declares 117 crons
  including both paths at the schedules tabled above.
- Both handlers still answer **401** unauthenticated on the live site
  (revision `three-ws-api-00420-ljh`, commit `880bdcef8`), so the
  `deployed, never synced` classification holds and neither job waits on a deploy.
- Neither handler has changed since this order was written, so the first-tick
  safety analysis above still describes the code that would run.
- The drift check's home in `data/guards.json` is intact
  (`stages: [gate, manual]`, `needs: gcloud`).

The owner runs one interactive login, then one command:

```bash
gcloud auth login                                    # interactive; unblocks every read below
npm run check:cron-drift                             # re-confirm WHICH jobs are missing
node scripts/create-gcp-scheduler.mjs --only globe-ingest,hood-portfolio-snapshot
npm run check:cron-drift                             # expect MISSING: 0
```

Run the first drift check before the sync rather than after only: if the live
list has moved on since 2026-09-09, `--only` should name whatever it reports,
not what this file remembers.

`--only` exists for exactly this: without it the sync re-touches all 117 jobs to
repair two. The secret needs no flag; the script reads production's
authoritative copy off the Cloud Run service and follows the Secret Manager
reference. The sync is config-only and leaves run state untouched on existing
jobs; a job it CREATES starts ENABLED, which is what these two need.

Then watch the first ticks. `globe-ingest` fires within 15 minutes, so it is the
faster signal; `hood-portfolio-snapshot` runs once a day at 02:17 UTC.

```bash
gcloud logging read 'resource.type="cloud_scheduler_job"
  resource.labels.job_id="cron--api-cron-globe-ingest"
  httpRequest.status:*' --freshness=1h --format='table(timestamp,httpRequest.status)'
```

A 403 means the secret did not match. A 200 carrying `skipped:
storage_high_water` is the write-capacity gate doing its job, not a failure.

## Verification

```bash
npm run check:cron-drift     # MISSING: 0
```
plus a successful invocation of each new job in the Cloud Scheduler logs.

**Read the output, not just the exit code, and be sure the run was authenticated.**
Until 2026-09-09 that command exited **0** when the gcloud session was dead: it
printed `Could not read Cloud Scheduler`, compared no live job at all, and
returned success, so the one command that proves this order is done passed while
proving nothing. That is the same silent failure the check exists to catch,
pointed at the check itself. `scripts/check-cron-drift.mjs` now exits 1 whenever
a live run cannot read Cloud Scheduler (covered by
`tests/cron-drift-unreadable-live.test.js`), and says so in `--json` as
`liveError`. An explicit `--offline` run (`npm run check:cron-syntax`, which is
what `npm run gate` runs) is a deliberate expression-only check and still exits
0, so the gate is unaffected. Practical consequence for whoever finishes this
order: a `MISSING: 0` line is now the only thing that closes it, and an
exit-1 `FAILED: could not read Cloud Scheduler` means log in first.

## Done when

Cloud Scheduler carries a job for every cron `vercel.json` declares (117 today,
and the count is derived rather than pinned: `npm run check:cron-drift` reads it
off the file), each newly created job has demonstrably run without error, and
the drift check has a defined home so the next divergence is caught rather than
discovered.

The last of those is **already done**: `check-cron-drift` is registered in
`data/guards.json` with `stages: [gate, manual]`, `needs: gcloud`, and a `why`
that splits the offline expression validation (in the gate, as
`check:cron-syntax`) from the live comparison (manual, needs an authenticated
session). Do not redo it.

## Retire this prompt when it is done (required)

1. Verify every Definition of done line against actual command output in front
   of you. Never claim a line you did not verify.
2. Record the outcome in this campaign's PROGRESS or INDEX file if it has one.
3. Commit with explicit paths and a subject that describes the diff (house
   style: type(scope): what changed and why a reader cares), and delete this
   prompt file in that same commit:

       git rm prompts/finish/905-fix-queue-03-cron-drift-garment-sweep.md

   A finished order left on disk reads as open work to the next agent, so the
   shrinking directory is the campaign's progress ledger.

If a line genuinely cannot pass inside this session (an external party must
respond, or an owner-gated action is the final step), finish everything else,
leave this file in place, and state exactly which line remains and who owns it.
Never delete this file on a partial.
