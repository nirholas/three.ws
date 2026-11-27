# 451 grok-fix-01: Deploy the xAI schema fix and prove Grok can use three.ws live

**How to run:** paste this whole file into a fresh Claude Code chat opened at `/home/nich/three.ws`. Read `CLAUDE.md` first. Campaign map (optional): [_context/grok-fix-00-CONTEXT.md](_context/grok-fix-00-CONTEXT.md).

**Operating clause (binding):** finish 100% in this session; do not ask the owner questions; no mocks, fake data, TODOs or stubs; never write the em-dash or en-dash character; bug fixes are test-first; stage explicit paths only and commit promptly with a message that describes the diff. This order is independent of orders 452 to 458: never wait on one, never assume one has landed.

**Owner approval carried by this file:** the owner running this order IS the approval for ONE production deploy of the current local `main` with `npm run deploy:gcp:full`, plus the CDN purge and verification steps the deploy runbook includes. It is NOT approval to `git push`, to change any Cloud Run env var or secret, or to install the xAI key on production.

## Why

On 2026-11-27 a live xAI run proved that every Grok model was refused three.ws tools: `pano_capture_start` published a root `anyOf` and xAI answers `HTTP 400 invalid_client_tool_schema` for the whole request. The fix (`a99f32c10`), a probe that catches it (`8b275ada1`), a stats fix (`848857cb2`) and the changelog (`e6f8ae31d`) are committed on `main` but production still serves the broken schema. Grok users have had no working connector since 2026-11-21.

## The xAI key

The owner's key is in `~/.config/three-ws/xai-local.key` (chmod 600, outside the repo). Pass it to one command at a time: `XAI_API_KEY="$(cat ~/.config/three-ws/xai-local.key)" <command>`. Never print it, never copy it into the repo, a `.env` file, a doc, a log, Secret Manager or Cloud Run, never run `npm run setup:xai-key`. Users must not be able to spend these credits. Proof-sized runs only. If the file is missing, skip the live xAI steps and say so in one line; do not hunt for a key elsewhere.

## Step 0: re-derive state (trust nothing above until measured)

1. `git log --oneline -15` and `git status`. Confirm the four commits are on `main`.
2. Is production already fixed? Ask production for its catalog and test every root:
   ```bash
   for p in mcp-grok mcp-studio; do curl -s https://three.ws/api/$p -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s.replace(/^data: /m,""));const bad=m.result.tools.filter(t=>{const r=t.inputSchema||{};return r.type!=="object"||["anyOf","oneOf","allOf","not","if","then","else","enum","const"].some(k=>k in r)}).map(t=>t.name);console.log(process.argv[1],m.result.tools.length,"tools, rejected:",bad)})' $p; done
   ```
   If both servers print `rejected: []`, someone already deployed: skip to step 3.
3. GCP access: `timeout 30 gcloud run services describe three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --account nich@sperax.io --format='value(status.latestReadyRevisionName,status.url)'`. If it prints "Reauthentication failed", the owner must run `gcloud auth login nich@sperax.io` and `gcloud auth login nich@three.ws` in a terminal on this machine. That is the only owner step this order can need. Install `python3-venv` (task 3) first, then report that one line.

## Tasks

1. **Deploy.** Load the `deploy-runbook` skill and follow it exactly and in order (`npm run deploy:gcp:full`; never hand-run `build:gcp` steps or a bare `gcloud builds submit`). There is no `.env.local` on this devbox: before the runbook's migration gate, write one containing only `DATABASE_URL=` from `node scripts/read-service-env.mjs '^DATABASE_URL$' --raw` (it is gitignored; confirm with `git check-ignore .env.local`). Run `npm run db:status` and read it; apply pending migrations only per the runbook. If a concurrent agent's uncommitted work is in the tree, the runbook's clean worktree from `HEAD` already excludes it.
2. **Prove the fix is live.** Rerun the step 0.2 check: both servers must print `rejected: []`. Then:
   - `XAI_API_KEY="$(cat ~/.config/three-ws/xai-local.key)" npm run e2e:xai-mcp`. It must pass (it failed with the 400 on 2026-11-27).
   - `npm run grok:mcp-probe` against production: every step green, including the new root-schema check.
   - `curl -s https://three.ws/api/grok/stats` and confirm the 24h tool-call count no longer includes the probe's `search_docs` calls (it was about 288 of 293 before).
3. **Run all six examples live as deploy proof:** `sudo apt-get install -y python3-venv` if `dpkg -s python3-venv` says it is missing (passwordless sudo works on the devbox; `grok-python-mcp` needs it), then `XAI_API_KEY="$(cat ~/.config/three-ws/xai-local.key)" npm run grok:examples-smoke`. Before the deploy, `grok-curl` and `grok-python-mcp` failed only on production's 400. Record each example's PASS/FAIL. Fixing example code (the `jq` crash in `examples/grok-curl/run.sh` on an xAI error body, README captures) belongs to order 458; do it here only if `git log --oneline -5 -- examples/` shows 458 has not landed and a failure blocks your proof, test-first.
4. **Status page.** Confirm `/status` (or the endpoint the probe writes to, see `api/cron/mcp-probe.js`) shows the Grok-facing servers green after the next 5-minute probe tick.
5. **Changelog.** If anything you changed is user-visible behaviour, append one `data/changelog.json` entry (tags `fix`, link `/grok`), then `npm run build:pages` and stage what it regenerates.
6. **Clean up.** `git worktree remove --force <deploy worktree>` per the runbook. Delete `.env.local` if you created it and nothing else in the repo expects it (it holds only the DB URL you wrote).

## Definition of done

- [ ] `tools/list` on `https://three.ws/api/mcp-grok` and `/api/mcp-studio` returns zero rejected roots.
- [ ] `npm run e2e:xai-mcp` passes against production with the local key.
- [ ] `npm run grok:examples-smoke` run with the local key; every example's result recorded, and any failure traced to its cause.
- [ ] `npm test` passes (a red you did not cause gets one line in the report).
- [ ] Nothing pushed. The key is nowhere in the repo: `git grep -c "xai-[A-Za-z0-9]\{20,\}"` prints nothing.
- [ ] One entry appended to `prompts/finish/_context/grok-fix-PROGRESS.md`.

## Never blocked

- Deploy fails mid-build: load the `deploy-preflight` agent's checks, fix the root cause, rerun from the runbook step that failed.
- `db:check` exit 4: read `npm run db:status`, then `npm run db:migrate` per the self-unblock playbook.
- Disk full: `npm run clean:worktrees -- --apply`.
- An example fails because of an xAI outage: retry once after 60 s; if `https://status.x.ai` shows an incident, record it and rerun the rest.

## Report format

Revision deployed and its commit; each proof command with PASS/FAIL and the one line of evidence; commits made; what remains and who owns it.
