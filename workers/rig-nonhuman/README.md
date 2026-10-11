# model-rig-nonhuman: auto-rigging worker for quadrupeds, creatures, and props

`workers/rig`'s engine (Make-It-Animatable) is trained on bipedal humanoids:
it predicts a fixed 52-bone Mixamo skeleton and will not produce a usable rig
for a four-legged creature, a winged mount, or an inanimate prop. This worker
covers everything that worker's mesh classifier calls non-humanoid, using a
different pair of engines that predict an arbitrary joint hierarchy instead
of fitting one fixed template.

## How it works

1. **Skeleton**: [UniRig](https://github.com/VAST-AI-Research/UniRig) (MIT,
   SIGGRAPH '25) autoregressively predicts a topologically valid joint
   hierarchy for the input mesh (`launch/inference/generate_skeleton.sh`),
   then grafts it onto the original GLB (`launch/inference/merge.sh`). No
   skin weights yet.
2. **Skinning**: [SkinTokens](https://github.com/VAST-AI-Research/SkinTokens)
   (MIT), UniRig's successor, predicts ONLY the skin weights for that
   skeleton-merged mesh (`demo.py --use_skeleton --use_transfer`), preserving
   the original texture and scale and writing the final rigged GLB directly.
   The work order specifies SkinTokens for this step rather than UniRig's own
   `generate_skin.sh`: it is the newer, better-performing model for exactly
   this sub-task (98-133% skinning-accuracy improvement per its README).

Both are subprocess CLIs, not importable Python packages; `pipeline.py`
chains them exactly per their own documented command contracts (verified
against their live READMEs 2026-10-09/2026-10-11, not assumed from memory).
`main.py` validates the input mesh the same way `workers/rig` does
(duplicated here, not imported: each worker's Docker build context is
isolated and cannot reach `../rig`).

## Reached two ways

Directly, or forwarded by `workers/rig`: that worker's `mesh_classify.py`
runs a cheap geometric heuristic (height/footprint ratio + bilateral mirror
symmetry) on every input mesh before dispatching, and forwards non-humanoid
meshes here when `RIG_NONHUMAN_URL` is configured on that service. Either
way the caller (or the forwarding worker, polling on the original caller's
behalf) sees the identical API shape, so nothing downstream needs to know
which engine actually rigged a given mesh.

## API

```
POST /rig        { mesh_gcs_url, job_id? }
                 -> 202 { task_id, status: "queued" }        (Bearer API_KEY)
GET  /tasks/:id  -> { task_id, status, rigged_gcs_url?, error?, elapsed_ms? }
GET  /health     -> { ok, model, gpu_available, gpu_name, queued }
```

Every task runs under a hard timeout (`TASK_TIMEOUT_S`, default 900s: three
chained model passes need more headroom than the single-pass humanoid
worker's 420s). Task state is in-memory, same invariant as `workers/rig`:
run with `min-instances = max-instances` so pollers always reach the
instance that owns the task.

## Deploy

One-time asset staging (UniRig's skeleton checkpoint, SkinTokens' two
checkpoints, and the Qwen3-0.6B config/tokenizer SkinTokens was fine-tuned
from, under `gs://three-ws-model-weights/rig-nonhuman/`):

```bash
bash workers/rig-nonhuman/stage-assets.sh
```

Build + deploy (Cloud Build pins the `three-ws-build@` service account):

```bash
gcloud builds submit --config workers/rig-nonhuman/cloudbuild.yaml \
  --substitutions=SHORT_SHA=manual$(date +%s) .
```

Service: `model-rig-nonhuman`, us-central1, 1x L4
(`--no-gpu-zonal-redundancy`), one warm instance against the per-region L4
quota in `docs/ops/gcp-credits-plan.md`. This is an additional GPU instance
alongside `model-rig`, not a replacement; budget for it in that quota plan
before deploying.

Then point `workers/rig` at it:

```bash
gcloud run services update model-rig --region us-central1 \
  --update-env-vars RIG_NONHUMAN_URL=$(gcloud run services describe \
      model-rig-nonhuman --region us-central1 --format='value(status.url)')
```

`RIG_NONHUMAN_URL` is unset by default, so until that command runs, 100% of
`model-rig` traffic stays on the pre-existing humanoid path: this service
deploying does not change behavior on its own.

## Local tests (no GPU needed)

```bash
cd workers/rig-nonhuman
python3 test_pipeline.py      # command contracts + subprocess chaining/errors
python3 test_gltf_meshopt.py  # the meshopt decode every input GLB passes through
```

`test_pipeline.py` checks the three command builders against UniRig's and
SkinTokens' real CLI contracts, then exercises `run_pipeline`'s chaining and
error handling by substituting tiny real scripts at the exact relative paths
the commands invoke (a nonzero exit, a reported success with no output file,
and a failure at the merge stage are each asserted to stop the chain with a
`PipelineStepError` naming the failed step), so the logic that will run in
production is exercised without a GPU, torch, or either upstream checkout.

## Licensing

UniRig and SkinTokens are both MIT (LICENSE files read 2026-10-09); Qwen3-0.6B
(Apache 2.0) supplies only its config/tokenizer, not weights, per upstream's
own `download.py`. No research-only license terms in this rigging path.

## Environment

| Var | Default | Meaning |
|---|---|---|
| `API_KEY` | (secret) | shared bearer secret (`avatar-reconstruction-key`) |
| `GCS_BUCKET` | (required) | output bucket for rigged GLBs |
| `UNIRIG_DIR` | `/app/unirig` | UniRig checkout |
| `SKINTOKENS_DIR` | `/app/skintokens` | SkinTokens checkout |
| `MAX_CONCURRENT` | `1` | parallel rig jobs per instance |
| `TASK_TIMEOUT_S` | `900` | per-task hard timeout |
| `WEIGHTS_ROOT` | `/weights/rig-nonhuman` | staged assets, read by `entrypoint.sh` |

## Failure modes

| Reported `error` | Cause | Fix |
|---|---|---|
| `input is not a binary glTF...` | `mesh_gcs_url` returned something that is not a `.glb` | fix the URL; rejected before touching the GPU |
| `input GLB contains no triangles...` | a point cloud or curves-only export | rig a surface mesh |
| `unirig-skeleton failed (exit ...)` / `unirig-merge failed (...)` / `skintokens-skin failed (...)` | the named stage's subprocess exited nonzero | the error carries a stderr tail; grep service logs for the full capture |
| `... reported success but wrote no output file` | the named stage crashed without a nonzero exit | same as above, treat as that stage's failure |
| `rigging timed out after 900s` | `TASK_TIMEOUT_S` elapsed | retry, or raise the timeout for very dense/complex meshes |
| `internal error (ref <id>)` | anything unexpected | grep the service logs for the correlation id |
