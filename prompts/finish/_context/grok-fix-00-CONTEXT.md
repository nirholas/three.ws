# grok-fix campaign: shared context

Not a work order. Never run this file. Orders `451`, `452`, `454` and `456` to `458` (`prompts/finish/45N-grok-fix-*.md`) each inline everything they need, so an agent can run one without reading this; it exists so the owner and the next agent can see the whole campaign at once. CLAUDE.md overrides everything here.

## Why the campaign exists (filed 2026-11-27)

xAI asked three.ws to take down the 2026-11-25 Grok for Startups announcement thread ([docs/x-posts/2026-11-25-grok-for-startups-announcement.md](../../../docs/x-posts/2026-11-25-grok-for-startups-announcement.md)). The program grants API credits only: no co-marketing, no marketplace placement, no working relationship with the xAI, SpaceXSI or Cursor teams. An audit of that thread flagged posts 3, 5, 6, 7 and 8 too; the owner reviewed it and kept them (see The orders).

The same day, a live xAI key run found that **Grok could not use three.ws at all**: `pano_capture_start` (added 2026-11-21) published an input schema whose root carried an `anyOf`, and xAI's Responses API rejects the whole request (`HTTP 400 invalid_client_tool_schema`) when any one tool's root is a union. Every three.ws tool was offline for every Grok model on `/api/mcp-grok` and `/api/mcp-studio`, while the uptime probe stayed green and `/grok` counted the probe's own calls as Grok usage.

## What already landed on `main` (committed 2026-11-27, NOT deployed, NOT pushed)

- `a99f32c10` fix(mcp-grok): the root `anyOf` moved into a server-only `serverSchema` in [api/_mcp-studio/pano-tools.js](../../../api/_mcp-studio/pano-tools.js); test in [tests/mcp-grok.test.js](../../../tests/mcp-grok.test.js).
- `848857cb2` fix(grok-stats): `/api/grok/stats` excludes the probe's exact call ([api/_lib/grok-stats.js](../../../api/_lib/grok-stats.js)); test in [tests/grok-stats.test.js](../../../tests/grok-stats.test.js).
- `8b275ada1` fix(mcp-probe): tools/list fails when a tool root schema would make xAI refuse the connector ([api/_lib/mcp-probe.js](../../../api/_lib/mcp-probe.js) `clientAcceptsRootSchema`); test in [tests/mcp-probe.test.js](../../../tests/mcp-probe.test.js).
- `e6f8ae31d` docs(changelog): the user-facing entry.

Proven live with the key on 2026-11-27: a direct xAI call with the old catalog returned 400 and with the fixed catalog returned 200 (21 tools). `grok-node-responses`, `grok-x-search-to-3d`, `grok-agent-avatar` and `grok-build-workflow` passed; `grok-curl` and `grok-python-mcp` failed (production still serves the bad schema; the devbox lacks `python3-venv`; `run.sh` crashes in `jq` on an xAI error body).

## The orders

Run 451, 454, 456, 457 and 458 at once; each is independent. Run 452 last, because it assembles the thread from their results.

- [451](../451-grok-fix-01-deploy-and-prove-live.md) Deploy `main` and prove the connector live through xAI. Running it is the deploy approval.
- [454](../454-grok-fix-04-tool-schema-portability.md) One schema-portability gate across every MCP server.
- [456](../456-grok-fix-06-llm-eval-grok-columns.md) Run the Grok 4.7 columns of the LLM eval.
- [457](../457-grok-fix-07-ref-image-eval-grok-column.md) Run the Grok Imagine column of the reference-image eval.
- [458](../458-grok-fix-08-examples-and-grok-build-live.md) Make all six Grok examples and a Grok Build model turn pass live, against a tunnel to a local server if production is not fixed yet.
- [452](../452-grok-fix-02-repost-thread-honest.md) **Last.** Assemble [the repost thread](../../../docs/x-posts/2026-11-27-grok-for-startups-repost.md): refresh its numbers, fill the eval post, check every surface and link, print the final text. Running it is approval to commit the funding source its post 15 names.

Withdrawn 2026-11-27: 453 (overclaim sweep) and 455 (numbers that exclude our own traffic). The owner decided the original thread is true apart from the co-marketing clause: keep "the first crypto-native company approved", the marketplace line and the original framing, remove only the co-marketing, and add the new Grok work. Do not re-litigate those lines. Order 452's first run (`ed86dc046`) rewrote `docs/x-posts/2026-11-25-grok-for-startups-announcement.md` more strictly than the owner chose; that file is not the one to post.

## Shared facts

- The owner's xAI key lives at `~/.config/three-ws/xai-local.key` (chmod 600, outside the repo). Pass it to one command at a time as `XAI_API_KEY` / `GROK_API_KEY`. It never goes into the repo, a `.env` file, a doc, a log, Secret Manager or Cloud Run, `npm run setup:xai-key` is never run, and users must not be able to spend these credits.
- Google Cloud: on 2026-11-27 both `nich@sperax.io` and `nich@three.ws` needed `gcloud auth login` (tokens expired; non-interactive reauth fails). Orders that need GCP do everything else first and name that one line if it is still expired. There is no `.env.local` on the devbox; `DATABASE_URL` comes from the Cloud Run service via `node scripts/read-service-env.mjs '^DATABASE_URL$' --raw`.
- Wording rules: [grok-startups-00-CONTEXT.md](grok-startups-00-CONTEXT.md) "Saying it correctly". The approved claim is "three.ws is a member of xAI's Grok for Startups program." Program = credits only.
- Progress log: [grok-fix-PROGRESS.md](grok-fix-PROGRESS.md). Append one dated entry per order run.
