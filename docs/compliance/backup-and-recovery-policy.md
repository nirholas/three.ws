# Backup, recovery, business continuity and disaster recovery policy

Owner and approver: the platform owner. Review cadence: every 12 months, with a restore exercise at least every quarter. Last reviewed: 2026-11-16. Approval: pending the owner's signature.

## Objectives (measured, not estimated)

| Objective | Value | How known |
|---|---|---|
| Recovery time for the database from the independent dump | 215 s (download 5 s, restore 210 s into a fresh PostgreSQL 17), measured 2026-11-16, 762 of 762 tables restored with 0 errors | the restore test that runs inside every backup build; figures republished in `gs://three-ws-db-backups/neondb/latest.json` |
| Recovery point of the independent dump | 24 hours (daily 06:30 UTC schedule) | schedule in [deploy/db-backup](../../deploy/db-backup/README.md) |
| Recovery point of Neon point-in-time restore | the provider's history window, down to the second | Neon project settings |
| Application recovery | minutes | Cloud Run revisions are immutable and traffic can return to a previous revision at once |

## Backups

1. **Neon point-in-time history** is the first line of recovery for an accidental change.
2. **Daily logical dump** to `gs://three-ws-db-backups` (us-central1) by Cloud Build as `three-ws-build@`. Uniform access, public access prevention on, a 30-day retention policy that no one can shorten (objects cannot be deleted or replaced earlier), lifecycle delete at 35 days, 7-day soft delete. This is the immutable copy.
3. **Object storage** (R2) holds user files; account deletion and retention jobs manage it, and generated files can be regenerated.
4. **Source and infrastructure as code** live in git (GitHub) and `vercel.json`/`server/` configuration; the container image is rebuilt from the repository by `npm run deploy:gcp:full`.

## Restore testing

Every dump is restored inside the same build into a throwaway PostgreSQL server: checksum verified, table count compared, and every critical table's restored row count must fall between the counts taken before and after the dump. The build fails otherwise and the failure raises an alert. The quarterly exercise is a real restore into a new Neon branch following "Restore for real" in the deploy README, timed and noted in the review log.

## Business continuity plan

| Function | Contingency |
|---|---|
| Web app and API unavailable | roll back to the previous Cloud Run revision; if the region fails, deploy the same image to another region with the same secrets (the service is stateless apart from Neon, R2 and Redis) |
| Database lost or corrupt | restore from Neon history, else from the latest dump (RTO above); point `DATABASE_URL` at the restored target |
| Payment rail or an AI provider down | provider failover ladders and per-rail degradation, described in [docs/ops/](../ops/) runbooks; status shown on [/status](https://three.ws/status) |
| Owner unavailable | the recovery steps are scripted and documented so a successor with access can follow them; naming a deputy with break-glass access is a planned action (risk R10) |

Roles: the platform owner is incident commander, operator and approver; the escalation process is the one in the [incident response plan](../incident-response.md).

## Disaster recovery plan

In-scope systems, in recovery order: (1) Neon database, (2) Secret Manager values, (3) Cloud Run `three-ws-api`, (4) Cloud Scheduler jobs (`scripts/create-gcp-scheduler.mjs` recreates them from `vercel.json`), (5) worker services, (6) R2 and CDN. Procedure: restore data, redeploy from git with the runbook ([docs/ops/gcp-production.md](../ops/gcp-production.md)), resync schedulers, verify `/api/healthz`, `/api/version` and `/status`, then notify affected customers under the incident plan.

## Exercises and review

The plan is reviewed every 12 months and after any incident, and changed for lessons learned. Exercise record: 2026-11-16, automated restore test, 215 s RTO. A full tabletop exercise for the owner-unavailable case has not been held yet and is on the owner pack.
