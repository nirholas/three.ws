# nvidia 01: the /nvidia page proves every NVIDIA lane is live, with measured GPU numbers from real job telemetry

> Status 2026-11-16: code complete and committed (72b323d0d, f01b9d114, 95d3dd512, e647d25ad). Waiting on the owner: `git push threews main`, `npm run deploy:gcp:full`, and the Cloud Scheduler sync for /api/cron/nvidia-lane-probes. Archive this file once production shows /nvidia#live.

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `nvidia-` order, so it can run in parallel with all of them. Dev port: 3251.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/nvidia-00-CONTEXT.md](_context/nvidia-00-CONTEXT.md) (facts, the technology-claim rule, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, `three-ws-api` deploy, Inception portal edits, NVIDIA submissions, forum or social posts) into ONE message at the end. Never contact NVIDIA or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

`/nvidia` is where NVIDIA program staff, catalog curators and Showcase editors land, and NVIDIA named "clear demos of NVIDIA acceleration" as a selection signal. Today the page describes the stack in static copy. A page that shows each NVIDIA lane answering right now, with p50 and p95 latency per lane and per GPU type drawn from real jobs, is proof instead of claims, and it hands every future post a number to quote.

## Step 0: re-derive the current state

    grep -n "<section\|<h2" pages/nvidia/index.html
    cat api/_lib/migrations/20261111163000_forge_worker_stats.sql
    grep -rln "forge_worker_stats" api scripts | head
    curl -s https://three.ws/api/healthz | head -c 2000; echo
    grep -n "'/nvidia" vercel.json vite.config.js | head

Record which NVIDIA lanes healthz already probes, which GPU workers write `forge_worker_stats`, and how many rows exist per worker over the last 30 days (read-only query against production through the documented database path).

## Tasks

1. **Lane probes.** A cron that sends the smallest valid real request to each hosted NVIDIA lane (NIM chat default rung, vision, embeddings, NemoGuard, Magpie TTS, Audio2Face-3D, TRELLIS on NVCF) and records status, latency and model id in a new table (migration). Reuse healthz probes where they exist. Cadence chosen from the documented free-tier limits, never so frequent that it competes with users. Register the cron in `vercel.json` (anchored edit, last).
2. **Public stats API** `GET /api/nvidia/stats`: per lane the last probe result and time, 7 and 30 day p50 and p95, job count, GPU type and region for the self-hosted workers from `forge_worker_stats`. Cached at the CDN for five minutes. No user ids, prompts, internal hostnames or keys. A lane with no data says so explicitly.
3. **"Live right now" section** on `/nvidia`: a lane grid with status, latency and model id, and a "GPU fleet by the numbers" chart comparing L4 and RTX PRO 6000 per lane (load the `dataviz` skill first). Skeleton loading, a designed error state and an empty state per lane. A methodology note says exactly what is measured and how.
4. **Benchmarks subpage** `/nvidia/benchmarks` with the full tables, the methodology, and a CSV download served by the API. Register in `data/pages.json`, `vercel.json` and `vite.config.js` with anchored edits.
5. **Tests**: aggregation on an isolated database (`scripts/lib/isolated-db.mjs`) with rows written through the real write path, API shape and caching headers, and a scan proving no secret or internal URL leaves the endpoint.
6. **Docs and changelog.** A section in [docs/nvidia-inception.md](../../docs/nvidia-inception.md) linking the live numbers; changelog entry; `npm run build:pages`.

## Definition of done

- [ ] `GET /api/nvidia/stats` on the dev server returns real numbers for every lane with data and an explicit empty marker for the rest (output in the report).
- [ ] `/nvidia` and `/nvidia/benchmarks` verified at 1280 and 400 px, light and dark, no console errors (screenshot paths).
- [ ] Probe cron runs locally against the real endpoints and writes rows; tests pass; `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A lane has no jobs in the window | Show "no jobs in the last 30 days" for it. Never backfill or estimate. |
| A probe hits a rate limit | Back off, lengthen that lane's cadence, and record the limit in the doc. |
| Production database access for step 0 | Follow the database row of the `self-unblock-playbook` skill; read-only queries only. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/nvidia-PROGRESS.md](_context/nvidia-PROGRESS.md), including the measured number this order produced.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
