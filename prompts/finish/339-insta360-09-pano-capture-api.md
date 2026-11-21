# insta360 09: the `/api/pano-capture` job API with persistence, ownership and capture history

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `insta360-` order, so it can run in parallel with all of them. Dev port: 3339.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/insta360-00-CONTEXT.md](_context/insta360-00-CONTEXT.md) (contract C4 `pano-capture` rows are yours; you call C1 over HTTP; you are the only order that writes a migration). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, deploy, env vars, the production migration if your session cannot apply it safely) into ONE message at the end.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill and the `self-unblock-playbook` skill (database and migration rows) before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

A splat job runs 10 to 40 minutes on a GPU. Users close tabs, switch devices and come back tomorrow. The job must live in the database, belong to its owner, survive any Cloud Run instance restart, and leave files in the user's own storage after the worker's 7-day URLs expire. This endpoint is what `/capture` (340), Blender (343), Premiere (344) and MCP and the CLI (345) all call.

## Step 0: re-derive the current state

    sed -n 1,220p api/scene-capture.js
    ls api/_lib/migrations | tail -15
    npm run db:status 2>&1 | tail -15
    grep -rn "CREATE TABLE" api/_lib/migrations/*.sql | grep -iE "job|capture|generation|forge" | head
    grep -n "mcp3dGenerate" api/_lib/*.js | head
    grep -n "GCP_VIDEO2SCENE_URL" api/_lib/env.js

Record the migration naming, how an existing jobs table (forge, reconstruction or similar) models status and ownership, and the R2 helper used for copying.

## Tasks

1. **Migration** `api/_lib/migrations/<fresh UTC timestamp>_pano_captures.sql`: table `pano_captures` (`id` uuid, `user_id`, `status`, `stage`, `progress`, `source_kind`, `source_url`, `source_urls` jsonb, `trim` jsonb, `quality`, `worker_task_id`, `result` jsonb, `error` jsonb, `stats` jsonb, `created_at`, `updated_at`, `finished_at`), indexes on `(user_id, created_at desc)` and `(status)` for active jobs. Follow the existing style. Test it on the isolated database first (memory `isolated-db-live-checks`, `scripts/lib/isolated-db.mjs`). Then read `npm run db:status`; apply to production with `npm run db:migrate` only if the playbook's migration row says that is how this repo ships migrations and the status shows nothing unexpected pending; otherwise put it in the owner message.
2. **Endpoint** `api/pano-capture.js` per contract C4 (POST, GET by job, GET mine, DELETE), modelled on [api/scene-capture.js](../../api/scene-capture.js): `requireCreator`, `limits.mcp3dGenerate`, `assertPublicHttpsUrl` on every URL (accept the R2 URLs the upload API returns), CORS, `{ error, message }` errors, 503 `unconfigured` when `GCP_PANO2SPLAT_URL` is unset (add it to `api/_lib/env.js` per C5, hot file, last). At most 2 active jobs per user.
3. **Status sync without a worker callback**: on each `GET ?job=` for an active job, poll the worker's `GET /tasks/{id}` (C1) at most once per 5 seconds per job (cache the last poll time in the row), update the row, and return it. Add a cron (`vercel.json` crons plus handler, hot file, last) every 5 minutes that advances any active job nobody is polling, so jobs finish and files are copied even when the user closed the tab.
4. **Finalisation** when the worker reports `succeeded`: copy `ply`, `spz`, `preview`, `poster` from the signed GCS URLs to R2 `captures/pano/<user_id>/<job_id>/` (streaming, no full-file buffering in memory; a 500 MB PLY must not blow the instance), store R2 URLs in `result`, set `viewer_url` to `/splat?src=<encoded spz url>` (check in step 0 that `/splat` accepts `src` and SPZ; if it accepts only PLY, point at the PLY and note it). Idempotent: a second finaliser run does nothing.
5. **Delete**: active job calls worker `DELETE /tasks/{id}`; finished job deletes the R2 objects then the row. Owner only.
6. **Account surface**: if the account area lists a user's generations or captures (find it with `grep -rln "my-captures\|my generations\|/account" pages src | head`), add pano captures to it with poster, status and links. If no such list exists, `GET ?mine=1` is consumed by order 340's page and that is enough.
7. **Tests** `tests/pano-capture.test.js` on the isolated database: create validation, per-user active limit, ownership on GET and DELETE, poll throttle, finaliser idempotency, unconfigured response, worker error passthrough (`code` and `message` unchanged). Use a local HTTP server that speaks C1 for the worker side (allowed by the context file). Production code calls only `GCP_PANO2SPLAT_URL`.
8. **Live proof of your side**: against the isolated database and the real R2 bucket, create a job pointing at a C1-speaking server. If order 337 left a job-proven image in the progress log, you may run that image locally or as a Cloud Run Job with an HTTP port only if it is practical; otherwise a contract-speaking local server is the honest stand-in for this order and 347 runs the real chain. Prove the finaliser copies real files: point it at real signed GCS objects you upload from a real splat (any real PLY and SPZ the repo or GCS already has), and verify the R2 copies byte for byte.
9. Docs: API reference, capture docs section, changelog entry.

## Definition of done

- [ ] Migration written, tested on the isolated DB, and either applied (with `db:status` before and after in the report) or in the owner message.
- [ ] Endpoint matches contract C4 field for field; cron registered; tests pass.
- [ ] Finaliser proven on real files against the real R2 bucket, byte-identical.
- [ ] `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Production DB access unclear | Isolated DB proves the code; production migration goes in the owner message with the exact command. |
| Worker not deployed | Expected; contract-speaking server for tests, real-file finaliser proof, 347 runs the chain. |
| `/splat` lacks `?src=` | Check the real parameter name in step 0 and use it; if none exists, add `src` handling to `/splat` with a minimal anchored change and a test, since it is needed by every capture result. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/insta360-PROGRESS.md](_context/insta360-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
