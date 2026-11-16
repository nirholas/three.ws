# Change management policy

Owner and approver: the platform owner. Review cadence: every 12 months. Last reviewed: 2026-11-16. Approval: pending the owner's signature.

## What counts as a change

Any commit to `main`, any deploy to Cloud Run, any schema migration, any change to Google Cloud configuration or to a Secret Manager value, and any Cloud Scheduler job change.

## Process

1. **Request and impact.** Work starts from a written task (an issue, a work order under `prompts/`, or the owner's instruction). The commit message states what changed and why a reader would care (enforced by the pre-push lint in `npm run check:rules`).
2. **Testing.** Logic changes carry tests in `tests/` and run on an isolated in-process database; a bug fix starts with a failing test. UI changes are exercised in a real browser on a local dev server.
3. **Review.** The diff is reviewed before commit. Reviewers are the owner and, for agent-written work, the repository's completion audit (`.claude/agents/completionist`). There is no second human reviewer: this is a recorded gap (risk R1), with branch protection and a required review as the planned fix, and it is the one control in this policy that does not meet the Microsoft 365 requirement of a second reviewer.
4. **Approval.** Pushing to the canonical remote, deploying to production and publishing externally need the owner's explicit approval (CLAUDE.md, gate 2).
5. **Deploy.** `npm run deploy:gcp:full` runs the documented chain ([docs/ops/gcp-production.md](../ops/gcp-production.md)): database checks (`db:check`), `audit:deploy`, API import check, then Cloud Build under the `three-ws-build@` account, then scheduler sync and CDN purge, then verification against `/api/version` and `/api/healthz`. Migrations apply with `npm run db:migrate` after reading `npm run db:status`.
6. **Back-out.** Cloud Run revisions are immutable, so rollback is `gcloud run services update-traffic` to the previous revision (minutes). Database changes are forward-only migrations; recovery is the restore procedure in the [backup and recovery policy](backup-and-recovery-policy.md).
7. **Record.** Git history is the change log; user-visible changes also add an entry to `data/changelog.json`.

## Environments and separation

- Production: Cloud Run `three-ws-api` and the production Neon database.
- Development and test: the developer's machine with `npm run dev`; automated tests run against an in-process PGlite database that contains no production data ([scripts/lib/isolated-db.mjs](../../scripts/lib/isolated-db.mjs)).
- Gap: a developer's `.env.local` currently holds the production database URL, so a dev server can read production data. Risk R2 tracks moving it to a dedicated Neon branch. Until then, live checks use the isolated database and the dev server is used for UI work only.
- Separation of duties is not enforced by access control because one person holds every role (risk R10).

## Emergency changes

A fix for a SEV1 or SEV2 incident may be deployed before full review. It is written up in the incident record and reviewed within 7 days.
