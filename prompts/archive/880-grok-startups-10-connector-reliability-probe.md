# grok-startups 10: a synthetic probe for the Grok-facing MCP connectors with real uptime numbers

> Status 2026-11-20: built and committed (b4c86c4d8, 65982e7a0, 50d7ae37c, c8e49cb19, 6bea11649, 7f900b409); migration 20261120205747_mcp_probe_results.sql is applied in production. Remaining, owner: `git push threews main`, then `npm run deploy:gcp:full`, whose sync-crons step creates the `cron--api-cron-mcp-probe` Cloud Scheduler job. Archive this file once /api/status/mcp answers 200 in production.

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `grok-startups-` order, so it can run in parallel with all of them. Dev port: 3280.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/grok-startups-00-CONTEXT.md](_context/grok-startups-00-CONTEXT.md) (facts, wording rules, parallel-run rules, the no-key rule). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, deploy, creating the Cloud Scheduler job if the sync script needs a deploy first) into ONE message at the end. Never contact xAI or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building and `changelog-and-docs` before close-out. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Marketplace reviewers at Cursor and xAI reject connectors they cannot reach, and a connector that fails during an xAI staffer's demo costs more than one that was never listed. We list `https://three.ws/api/mcp-grok` and `https://three.ws/api/mcp-studio` everywhere, yet nothing tells us when one of them stops answering `initialize` or `tools/list`. A synthetic probe every five minutes, a healthz subsystem, and a public uptime number turn "it works on my machine" into a reliability claim we can put in a listing.

## Step 0: re-derive the current state

    sed -n 1,80p api/healthz.js
    ls api/_lib/*-health.js
    sed -n 1,60p api/_lib/x-mention-health.js
    grep -n "\"crons\"" -A 5 vercel.json | head; grep -c "\"path\"" vercel.json
    sed -n 1,40p scripts/create-gcp-scheduler.mjs
    for u in mcp-grok mcp-studio; do curl -s -o /dev/null -w "$u %{http_code} %{time_total}s\n" -X POST "https://three.ws/api/$u" -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}'; done
    curl -s https://three.ws/api/healthz | head -c 800; echo

Read how existing crons authenticate (the cron secret pattern) and how one is added to `vercel.json` so `create-gcp-scheduler.mjs` picks it up.

## Tasks

1. **Probe library.** `api/_lib/mcp-probe.js`: for one server URL, run `initialize`, `notifications/initialized`, `tools/list` and one cheap, side-effect-free tool call (catalog search on studio; the cheapest read on mcp-grok, chosen by reading its tool list), each with a timeout and timing, over the Streamable HTTP transport exactly as Grok and Cursor use it (session header handling included). Returns a structured result with step, status, latency and error. Test it against a real local instance of each handler started in-process (the handlers are importable; find how other tests do it), not a stub server.
2. **Storage.** Migration `mcp_probe_results` (fresh UTC timestamp): `checked_at`, `server`, `ok`, `failed_step`, `latency_ms` per step as jsonb, `error`. Index on `(server, checked_at desc)`. Retention: a delete of rows older than 90 days in the same cron. Isolated-DB proof first; playbook database row for production.
3. **Cron.** `api/cron/mcp-probe.js` on a five-minute schedule in `vercel.json` (hot file), authenticated like the existing crons, probing every Grok-facing URL listed in [public/.well-known/mcp.json](../../public/.well-known/mcp.json) (read it at runtime; do not hardcode the list) plus the `?auth=oauth` discovery path (401 with resource metadata counts as healthy for that step).
4. **Health subsystem.** `api/_lib/mcp-probe-health.js` in `/api/healthz` subsystems: `ok` when the last two probes passed for every server, `warn` on one failure, `fail` on two consecutive failures or no probe in 15 minutes. Tests per state.
5. **Uptime numbers.** `GET /api/status/mcp` (route in `vercel.json`): per server, 24-hour, 7-day and 30-day success rate and p50/p95 latency computed from the table, cached 60 seconds. Public, no secrets. Render it on the existing status page if one exists (find it in `data/pages.json`); otherwise add a compact "Connector uptime" block to `/grok` (hot file, small anchored edit), rendered only when the endpoint answers, with a designed empty state for the first hours.
6. **Operator CLI.** `scripts/grok-mcp-probe.mjs` (npm script `grok:mcp-probe`) runs the probe once from this machine against production and prints the table, for use before any marketplace submission.
7. **Docs.** `docs/ops/mcp-probe.md` (what is probed, thresholds, how to read the endpoint) and the uptime endpoint URL in `docs/grok-bot.md` under reliability. Adding it to each listing's prepared section is order 929's job, so leave the listings doc alone. Changelog entry.

## Definition of done

- [ ] `npx vitest run tests/mcp-probe*.test.js` passes against in-process real handlers.
- [ ] `npm run grok:mcp-probe` prints a PASS row for every Grok-facing server in production with per-step latency.
- [ ] The cron handler run locally against the isolated DB writes real rows, and `/api/status/mcp` on your dev server computes rates from them.
- [ ] `/api/healthz` on your dev server includes the `mcp-probe` subsystem.
- [ ] `npm test` and `npm run audit:docs` pass (unrelated reds named in one line).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A production server fails the probe right now | That is the probe working. Diagnose it, fix the root cause test-first if it is in our code, and report it. |
| Handlers do not import cleanly in tests | Follow the pattern of the existing MCP handler tests; if none exist, start the dev server on your port and probe it. |
| Cloud Scheduler sync needs a deploy first | Commit everything, run `node scripts/create-gcp-scheduler.mjs --dry-run` if it supports it, and list the deploy plus sync in the owner message. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last (deploy, production migration, scheduler sync): leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/grok-startups-PROGRESS.md](_context/grok-startups-PROGRESS.md), including the measured number (p95 initialize-to-tools/list latency per server).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
