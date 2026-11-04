---
slug: avatar-longcat-gpu-host-bringup
title: LongCat video avatar worker runs on an 80GB GPU host with staged weights and an idle-stop lifecycle
tier: GATED
score: 40
area: avatar
sources: workers/longcat/README.md, workers/deploy/README.md, docs/ops/gcp-model-workers.md
---

## Why this matters

The talking-video avatar worker (`workers/longcat`) is built, but it needs an A100 or H100 80GB, which Cloud Run GPU (L4 only) cannot provide, and 44.81 GB of weights that have not been staged. The project's A100-80GB quota is 0, so nothing can start until a quota request is lodged and approved by Google. Almost everything else is agent-doable and can be finished now so that approval turns into a live capability with zero further engineering.

## Current state (measured by the reviewer on 2026-11-03)

- `workers/longcat/` contains the worker, README and `stage-weights.sh`. README names `a2-ultragpu-1g` or `a3-highgpu-1g` as the hosts and `LONGCAT_WORKER_URL` / `LONGCAT_WORKER_KEY` as the env that goes on three-ws-api (via `--update-env-vars`, never `--set-env-vars`).
- Secret Manager already holds `longcat-video-avatar-key`; the Artifact Registry repo `longcat-video-avatar` exists.
- Compute quota for A100 80GB in the target region is 0 (checked via `gcloud compute regions describe us-central1`). Weights are not in the model-weights bucket.
- No script manages the VM lifecycle, so a running 80GB GPU would bill continuously.
- `three-ws-api` does not have `LONGCAT_WORKER_URL` set; `api/_providers/gcp.js` is where GCP worker URLs are read.

## Step 0: re-derive the current state

```bash
cd /home/user/three.ws
gcloud compute regions describe us-central1 --project aerial-vehicle-466722-p5 --format=json | python3 -c "import json,sys; [print(q['metric'],q['limit'],q['usage']) for q in json.load(sys.stdin)['quotas'] if 'A100' in q['metric'] or 'H100' in q['metric']]"
gcloud storage ls gs://three-ws-model-weights/ 2>&1 | grep -i longcat || echo "weights not staged"
gcloud secrets list --project aerial-vehicle-466722-p5 --format='value(name)' | grep longcat
gcloud run services describe three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --format=json | grep -c LONGCAT
ls workers/longcat; grep -n LONGCAT api/_providers/gcp.js | head
```

## Tasks

1. Quota: write `workers/longcat/scripts/request-quota.sh` that prints the exact `gcloud alpha services quota update` (or console deep link) for `NVIDIA_A100_80GB_GPUS` and `NVIDIA_H100_GPUS` in `us-central1` and `us-east4`, with the justification text for the Web3 grant, and submit the preference with `gcloud alpha quotas preferences create` where the API allows it. Record the request id in the README. Also check Spot A100-80GB (`PREEMPTIBLE_NVIDIA_A100_80GB_GPUS`), which often has non-zero default.
2. Weights: run `workers/longcat/stage-weights.sh` from a Cloud Build or small CPU VM job (no GPU needed) so the 44.81 GB land in `gs://three-ws-model-weights/longcat/`; verify with `gcloud storage du` and a checksum manifest committed as `workers/longcat/weights.sha256`.
3. Lifecycle: add `workers/longcat/scripts/host.mjs` with `start`, `stop`, `status`, `ensure` subcommands over the GCE API (via `gcloud compute instances`), a startup script that pulls the container, mounts or syncs the weights, and serves the worker on a private port behind the existing bearer key. `ensure` starts the VM if stopped and waits for `/health`.
4. Idle stop: add an idle-shutdown check (no task for N minutes -> `shutdown -h`), configurable, tested in `workers/longcat/tests/idle-shutdown.test.js` against a fake clock and a recorded task log.
5. API wiring: make `api/_providers/gcp.js` read `LONGCAT_WORKER_URL` and `LONGCAT_WORKER_KEY` and return a typed "capacity unavailable, retry" response when the host is stopped and `ensure` has not completed, instead of a socket error. Add `tests/longcat-provider.test.js` covering configured, unconfigured and host-stopped branches.
6. Cost guard: add a hard daily GPU-hour cap that `ensure` honors, and the GCP-credit accounting line in `docs/ops/gcp-credits-plan.md`.
7. Document the full bring-up in `workers/longcat/README.md` as three owner-visible commands (start host, set env with `--update-env-vars`, smoke) plus the expected monthly credit burn.

## Definition of done

- [ ] `gcloud alpha quotas preferences list --project aerial-vehicle-466722-p5 | grep -i a100` shows the pending request, or quota is granted.
- [ ] `gcloud storage ls -l gs://three-ws-model-weights/longcat/` shows the full weight set matching `workers/longcat/weights.sha256`.
- [ ] `npx vitest run tests/longcat-provider.test.js workers/longcat/tests` passes.
- [ ] `node workers/longcat/scripts/host.mjs status` runs and reports the host state without error.
- [ ] README states quota status, request id, and the exact remaining owner step.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A100-80GB quota is 0 | Submit the quota preference and try Spot or alternate regions; finish every other task, report the pending request id |
| Weight staging is slow | Run it as a background Cloud Build job and continue with Tasks 3 to 7 |
| `--set-env-vars` temptation on three-ws-api | Always `--update-env-vars` |
| No GPU in the sandbox | Tests use recorded task logs and fake clocks; no GPU is needed for any test here |

## Gates

Starting the 80GB GPU host to run a real generation spends GCP credits (pre-approved resource, but Google's quota grant is an outside-party step). Stop at "quota granted -> run `host.mjs start`" and report it. No other gate.
