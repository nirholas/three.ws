# model-cosmos-reason

NVIDIA Cosmos Reason 2 8B, self-hosted on one Cloud Run L4 as the Forge physical-plausibility judge. It looks at four renders of a generated 3D model and answers: could this exist as shown, which physical problems it has (from a fixed list), and whether it matches the prompt. The API runs it beside the current quality gate, in shadow mode by default. This is **under evaluation**: the judge logs verdicts and only decides anything when the eval promotes it behind `FORGE_COSMOS_JUDGE`.

- **Model:** `nvidia/cosmos-reason2-8b` (Qwen3-VL architecture, 8B, bf16) under the NVIDIA Open Model License. It is pinned to NGC version `hf-0303`, from the NGC model registry (`nim/nvidia/cosmos-reason2-8b`). The hosted NIM endpoint returns 404 for our key and the Hugging Face repo is gated, so the weights come from NGC with the same `NVIDIA_API_KEY`.
- **Server:** the stock [vLLM](https://github.com/vllm-project/vllm) OpenAI-compatible image (`vllm/vllm-openai:v0.29.0`); this directory only adds `serve.sh`.
- **Weights:** these are not baked into the image. `cloudbuild.weights.yaml` runs `stage_weights.py`, which downloads every file from NGC and checks it against NGC's SHA-256 record. It writes the tree to `gs://three-ws-model-weights-euw4/cosmos-reason2-8b/` (16 objects, 17,545,909,204 bytes) with `REVISION` and `MANIFEST.json`. At every boot, `serve.sh` checks the mounted tree against the manifest before vLLM reads a byte, so a half-synced or re-pointed bucket fails the start instead of serving a different model.
- **Auth:** vLLM rejects any `/v1` request without `Authorization: Bearer <key>`. The key is the GPU fleet's shared `avatar-reconstruction-key` secret, which the API already holds as `GCP_RECONSTRUCTION_KEY` (or set `COSMOS_REASON_KEY`). `GET /health` stays open for the startup probe.
- **Where:** Cloud Run service `model-cosmos-reason` in `europe-west4`, because us-central1's L4 quota is held by other lanes. It runs on one NVIDIA L4 with 8 vCPU and 32 GiB, scales to zero (min 0, max 2, concurrency 8) and serves at an 8k context.

The judge code, the modes and the promotion rule are in [docs/forge-pipeline.md](../../docs/forge-pipeline.md#physical-plausibility-judge-nvidia-cosmos-reason). The eval is in [docs/nvidia/evals/cosmos-reason-judge-2026-11-16.md](../../docs/nvidia/evals/cosmos-reason-judge-2026-11-16.md).

## Files

| File | Role |
| --- | --- |
| `stage_weights.py` | Download the pinned NGC version, verify each file's SHA-256, write `MANIFEST.json`. |
| `test_stage_weights.py` | Unit tests for the staging script (`python3 -I workers/model-cosmos-reason/test_stage_weights.py`). |
| `cloudbuild.weights.yaml` | One-time staging into the weights bucket; a re-run exits early when `REVISION` already names the pinned version. |
| `serve.sh` | Verify the tree, warm the page cache, start vLLM. |
| `Dockerfile` | The vLLM image plus `serve.sh` and the pinned revision. |
| `cloudbuild.yaml` | Build, push and deploy the service. |

## Deploy

```bash
# once: stage the weights (skips when already staged)
TMPDIR=/home/user/.cache/gcloud-tmp gcloud builds submit \
  --config workers/model-cosmos-reason/cloudbuild.weights.yaml \
  --project aerial-vehicle-466722-p5 workers/model-cosmos-reason

# once: the build service account cannot create registries
gcloud artifacts repositories create model-cosmos-reason \
  --repository-format=docker --location=europe-west4 --project aerial-vehicle-466722-p5

# build and deploy
TMPDIR=/home/user/.cache/gcloud-tmp gcloud builds submit \
  --config workers/model-cosmos-reason/cloudbuild.yaml \
  --project aerial-vehicle-466722-p5 workers/model-cosmos-reason
```

The `gcloud run deploy` step can exit non-zero while the revision is still inside its 30 minute startup window, because the client treats the probe's interim "retrying" condition as a failure. Check the revision itself before redeploying: `gcloud run revisions describe <revision> --region europe-west4 --format='value(status.conditions[0].status)'`.

## Cold start (measured 2026-11-16, revision `model-cosmos-reason-00004-kd2`)

From instance start to `Application startup complete`: **8 min 41 s**.

| Stage | Time |
| --- | --- |
| Manifest check | 3 s |
| Page-cache warm (17.5 GB over GCS FUSE, in-region) | 293 s (60 MB/s) |
| vLLM import and engine setup | about 60 s |
| Weight load from page cache | 8 s |
| torch.compile | 48 s |
| Profile, KV cache, CUDA graphs, warmup | 42 s |

Three earlier attempts on the same day shaped `serve.sh` and the deploy flags:
- **Lazy mmap from the us-central1 bucket:** vLLM's default load faulted the shards in page by page at about 27 MB/s, 196 s per 5.3 GB shard. That failed a 15 minute startup probe.
- **vLLM's `--safetensors-load-strategy prefetch`:** it reads each file from 8 threads at once, which gcsfuse treats as random access, and one shard stalled outright.
- **A 16k context:** it left 1.15 GiB of KV cache after the vision-encoder profile, under the 2.25 GiB one full request needs, so the engine refused to start.

The fix for each:
- Weights moved to the europe-west4 bucket.
- One sequential reader per shard before vLLM starts.
- An 8k context, which leaves 1.84 GiB of KV cache (13,424 tokens, about five concurrent judge requests).

With min instances at 0, a cold start costs a missing shadow verdict, never a failed generation: the gate fails open and returns the current judge's verdict.

## Per request

A judge call is four 448 px PNG views plus the rubric: about 1,300 input tokens and 30 to 40 output tokens with reasoning off. Measured on a warm instance: 2.4 to 4.2 s per call. Rendering the four views on the API side (`renderCosmosViews`) adds about 22 s; it runs in parallel with the current judge. Latency percentiles over the full eval are in the eval report.

## API env

| Var | Effect |
| --- | --- |
| `COSMOS_REASON_URL` | Service URL. Unset keeps the judge off entirely. |
| `COSMOS_REASON_KEY` | Bearer key; defaults to `GCP_RECONSTRUCTION_KEY`. |
| `FORGE_COSMOS_JUDGE` | `off`, `shadow` (default), `veto`, `tiebreak` or `primary`. |
| `COSMOS_REASON_THINK=1` | Ask for a reasoning trace before the answer (stripped before storage). |
| `COSMOS_REASON_TIMEOUT_MS`, `FORGE_COSMOS_SHADOW_GRACE_MS` | Call timeout (45000) and the shadow wait after the current judge (6000). |
| `FORGE_COSMOS_VETO_ISSUES`, `FORGE_COSMOS_VETO_CONFIDENCE`, `FORGE_COSMOS_TIEBREAK_BAND` | Veto and tiebreak tuning. |

## Calling it directly

```bash
curl -s "$COSMOS_REASON_URL/v1/chat/completions" \
  -H "Authorization: Bearer $GCP_RECONSTRUCTION_KEY" -H 'content-type: application/json' \
  -d '{"model":"nvidia/cosmos-reason2-8b","temperature":0,"max_tokens":300,
       "messages":[{"role":"user","content":[
         {"type":"image_url","image_url":{"url":"data:image/png;base64,..."}},
         {"type":"text","text":"Is this object physically plausible? Answer as JSON."}]}]}'
```

In application code use `judgeWithCosmos` from `api/_lib/cosmos-reason-judge.js`, which builds the rubric prompt, enforces the issue list and strips any reasoning.
