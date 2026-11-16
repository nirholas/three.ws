# deploy/db-backup

Daily logical backup of the production Neon database, with a restore test on every run. Neon's own point-in-time history is the first line of recovery; this lane is the independent copy in our own Google Cloud project, so a lost Neon project, a deleted branch, or an account problem does not take the data with it.

## What runs

Cloud Scheduler job `db-backup-daily` (06:30 UTC) posts a Cloud Build body built by [scripts/schedule-db-backup.mjs](../../scripts/schedule-db-backup.mjs). The build runs as `three-ws-build@` on an `E2_HIGHCPU_8` worker and reads the `database-url-unpooled` secret. It has five steps:

| Step | Script | What it does |
| --- | --- | --- |
| dump | [dump.sh](dump.sh) | `pg_dump` directory format, 6 parallel jobs (retries twice, the last time single-process with a lock wait), tarred, sha256 recorded. Row counts of the critical tables are taken before and after the dump. |
| upload | [transfer.sh](transfer.sh) `upload` | Copies the archive to `gs://three-ws-db-backups/neondb/YYYY-MM-DD/HHMMSSZ/neondb.tar`. |
| download | [transfer.sh](transfer.sh) `download` | Pulls the archive back from the bucket, timed. This is the copy that gets restored, so the test proves the stored object, not the local file. |
| restore-test | [restore-test.sh](restore-test.sh) | Verifies the checksum, starts a throwaway PostgreSQL 17 with pgvector inside the build, runs `pg_restore`, compares the table count, and checks every critical table's restored row count falls between the before and after counts. |
| publish | [transfer.sh](transfer.sh) `publish` | Writes `report.json` beside the archive and to `neondb/latest.json`. The build fails unless the report says `"ok": true`. |

## Bucket

`gs://three-ws-db-backups` (us-central1): uniform access, public access prevention, a 30 day retention policy (objects cannot be deleted or replaced earlier, by anyone), lifecycle delete at 35 days, 7 day soft delete. Only `three-ws-build@` has object admin.

## Measured recovery numbers

From the verified run on 2026-11-16 (build `ed904bf2-40d9-4b58-a8dd-0706a48e0c20`, report `gs://three-ws-db-backups/neondb/2026-11-16/151623Z/report.json`):

| Metric | Value |
| --- | --- |
| Tables restored | 762 of 762, 0 restore errors |
| Archive | 1,906,216,960 bytes |
| Dump | 141 s |
| Download from GCS | 5 s |
| Restore | 210 s |
| Measured RTO (download + restore into a fresh server) | 215 s |
| RPO for this lane | 24 h (daily schedule) |

Every run republishes these numbers in `neondb/latest.json`, so the current figures are always one command away:

```bash
gcloud storage cat gs://three-ws-db-backups/neondb/latest.json
```

## Operate

```bash
node scripts/schedule-db-backup.mjs            # create or update the bucket policy and the scheduler job
node scripts/schedule-db-backup.mjs --run-now  # also trigger a run now
node scripts/schedule-db-backup.mjs --print    # print the Cloud Build body
```

Change a script here, then rerun `node scripts/schedule-db-backup.mjs`: the scripts are embedded in the scheduler body, so the job keeps running the old copy until it is updated.

## Restore for real

1. Pick the archive (`latest.json` names it) and download it: `gcloud storage cp gs://three-ws-db-backups/neondb/<date>/<time>/neondb.tar .`
2. Check `sha256sum neondb.tar` against `archive_sha256` in the report.
3. `tar -xf neondb.tar` gives a `dump/` directory.
4. Create the target (a new Neon branch or project) and run `pg_restore --jobs=8 --no-owner --no-privileges --dbname "$TARGET_URL" dump`.
5. Point `DATABASE_URL` at the target with `gcloud run services update three-ws-api --region us-central1 --update-secrets ...` once row counts match.

Policy context: [docs/compliance/backup-and-recovery-policy.md](../../docs/compliance/backup-and-recovery-policy.md).
