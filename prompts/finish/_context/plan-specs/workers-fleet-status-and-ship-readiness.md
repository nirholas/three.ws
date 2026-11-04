---
slug: workers-fleet-status-and-ship-readiness
title: One command reports which workers are live versus built-only, with verify builds and tests for each undeployed worker
tier: P2
score: 52
area: workers
sources: workers/README.md, workers/deploy/README.md, workers/texture/README.md, workers/cad-forge/README.md, workers/granite-guardian/README.md, workers/avatar-pipeline-controller/README.md, workers/robinhood-feed/README.md, workers/agent-mm/README.md, workers/pump-fun-mcp/README.md, workers/agent-forge/README.md, workers/agent-crawler/README.md, workers/agora-citizens/README.md, workers/model-lato2/README.md, workers/model-video2scene/README.md, workers/modly/README.md, workers/model-text2motion/README.md, docs/ops/gcp-model-workers.md
---

## Why this matters

About fifteen workers under `workers/` are built but have no Cloud Run service, and each README states "not deployed" in its own words, dated by whoever last looked. Nobody can tell at a glance which claims are still true, which workers would even build today, or what the one-line ship command is. That ambiguity is why finished capability (texture, cad-forge, granite-guardian, robinhood-feed, avatar-pipeline-controller, MoMask motion) sits idle. A generated fleet table plus build-only proofs turns every owner deploy decision into a single command.

## Current state (measured by the reviewer on 2026-11-03)

- `gcloud run services list` shows live: agent-sniper, avatar-reconstruction, garment-forge, model-asl-recognition, model-hunyuan3d (+21, +21-rtx), model-rig, model-text2motion, model-trellis, model-triposg, model-triposr, model-video2motion, okx-chat-bot, rembg-service, remesh-service, segment-service, stylize-service, three-ws-api.
- No service exists for: texture, cad-forge, granite-guardian, avatar-pipeline-controller, robinhood-feed, agent-mm, pump-fun-mcp, agent-crawler, agora-citizens, model-lato2, model-video2scene, modly, agent-gateway (own order), agent-orders (existing order 614), longcat (own order).
- `agent-screen-worker` is intentionally owner-run with no cloudbuild; do not add one.
- `workers/agent-orders/cloudbuild.verify.yaml` is the only build-only verify config in the tree.
- `docs/ops/gcp-model-workers.md` documents only the forge lanes. No script reports fleet-wide deployed state; `scripts/audit-deploy-artifacts.mjs` is unrelated.
- MoMask backend in `workers/model-text2motion` has never had an in-house production run (README lines near 208, weights at `gs://three-ws-model-weights/momask/`).

## Step 0: re-derive the current state

```bash
cd /home/user/three.ws
gcloud run services list --project aerial-vehicle-466722-p5 --format='value(metadata.name,status.url)' | sort
for d in workers/*/; do n=$(basename $d); printf "%-28s cloudbuild=%s verify=%s tests=%s\n" $n \
  $( [ -f $d/cloudbuild.yaml ] && echo y || echo n ) $( [ -f $d/cloudbuild.verify.yaml ] && echo y || echo n ) \
  $( ls $d | grep -qiE 'test' && echo y || echo n ); done
ls scripts | grep -iE 'fleet|workers'; grep -n '"workers:' package.json
```

## Tasks

1. Write `scripts/workers-fleet-status.mjs` (plain Node, no new dependencies). It enumerates `workers/*`, reads `gcloud run services list --format=json` for the project, matches each directory to its service via the `--service` / service name in that directory's `cloudbuild.yaml`, and prints a table: worker, service, live or not, URL, min and max instances, GPU, last deploy time, has cloudbuild, has verify config, has tests. Add `--json` and `--check` (non-zero exit when a worker whose README claims "deployed" has no service, or the reverse). Add `npm run workers:fleet`.
2. Add `tests/workers-fleet-status.test.js` for the pure parts (service-name extraction from cloudbuild YAML fixtures copied from real worker configs, README claim parsing, table rendering, `--check` exit logic). Feed it recorded `gcloud` JSON captured from the real project, not invented data.
3. For each undeployed worker with a Dockerfile (texture, cad-forge, granite-guardian, avatar-pipeline-controller, robinhood-feed, agent-mm, pump-fun-mcp, agent-crawler, agora-citizens, model-lato2, model-video2scene, modly), add `cloudbuild.verify.yaml` (build-only, pinned `three-ws-build@`, same pattern as agent-orders) plus a narrow `verify.gcloudignore` where the repo-wide context is large. Submit each with Cloud Build and record the result. A GPU worker's verify build is build-only and needs no GPU quota.
4. Where a worker has no tests at all, add the smallest honest suite for its pure logic (request validation, queue and lease logic, response shaping), in the worker's own test layout. Do not mock the model; test the contract around it.
5. Fix every build failure the verify builds expose (stale lockfile, missing COPY, base image drift), test-first where the failure is a code bug.
6. Run `npm run workers:fleet -- --check` and fix each README whose status line disagrees with reality: replace hand-written "not deployed (checked <date>)" with a pointer to the fleet command and keep the worker-specific ship command. Do the same for `workers/README.md`.
7. Generate `docs/ops/workers-fleet.md` from the script (`npm run workers:fleet -- --markdown`), include the ship command per worker and the quota or secret each needs, and link it from `docs/ops/gcp-model-workers.md` and `STRUCTURE.md`.
8. MoMask: write `workers/model-text2motion/scripts/benchmark-momask.mjs` that, against a worker URL passed in, sends the HumanML3D prompt set already referenced in the README, records frame counts, unit-norm check on every quaternion track and latency, and prints a table. Do not deploy; document the exact owner commands to stage weights, deploy the MoMask revision and run the script.

## Definition of done

- [ ] `npm run workers:fleet` prints a table where every `workers/*` directory appears, and `npm run workers:fleet -- --check` exits 0.
- [ ] `npx vitest run tests/workers-fleet-status.test.js` passes.
- [ ] Each listed worker has a successful Cloud Build verify run recorded in `docs/ops/workers-fleet.md` (build id per worker) or a one-line, evidenced reason it cannot build.
- [ ] `grep -rn "not deployed" workers/*/README.md` returns only lines that point to `docs/ops/workers-fleet.md`.
- [ ] `npm run audit:docs` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| gcloud not authenticated | Follow the GCP row of the self-unblock playbook; the project is aerial-vehicle-466722-p5 |
| A verify build needs more upload than the repo allows | Add a narrow `verify.gcloudignore` as agent-orders does |
| A worker needs GPU quota to build | It does not: verify builds never run the GPU image |
| Missing secrets referenced by a cloudbuild | Verify configs stop before deploy and need no secrets; list the secret names in the fleet doc |

## Gates

Actual `gcloud run deploy` of any worker is the routine owner deploy gate. Report the ship commands; do not run them.
