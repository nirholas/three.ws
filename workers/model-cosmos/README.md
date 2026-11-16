# model-cosmos: NVIDIA Cosmos 3 world generation

FastAPI service that renders the animated worlds behind avatars on
[/cosmos](https://three.ws/cosmos). It loads one checkpoint,
[nvidia/Cosmos3-Nano](https://huggingface.co/nvidia/Cosmos3-Nano) (OpenMDW-1.1,
see [`prompting/NOTICE.md`](./prompting/NOTICE.md)), through diffusers'
`Cosmos3OmniModularPipeline` and serves four modes from it on a Cloud Run
RTX PRO 6000 in `europe-west4`.

It is the first rung of the `/api/cosmos` model ladder
([`api/_lib/cosmos-ladder.js`](../../api/_lib/cosmos-ladder.js)). The hosted
`cosmos-predict1` routes sit behind it for text worlds while NVIDIA still serves
them. Product docs: [docs/cosmos.md](../../docs/cosmos.md).

| Mode | Input | What the model does | Steps / guidance / fps |
|---|---|---|---|
| `text` | prompt | text-to-world | 35 / 6.0 / 24 |
| `image` | prompt + a still of the caller's scene | the still becomes frame 0 (image-to-world) | 35 / 6.0 / 24 |
| `depth` | prompt + a depth control video (near = bright) | layout transfer: the world follows the scene's geometry | 50 / 3.0 (control 1.5) / 30 |
| `edge` | prompt + an RGB render | the worker runs Canny (100/200), then layout transfer | 50 / 3.0 (control 1.5) / 30 |

The numbers are NVIDIA's published defaults (the text2video and image2video
sample args, the transfer depth and edge specs) and live in
[`generation_config.py`](./generation_config.py), which imports no torch so the
whole request contract is unit tested on any machine. Geometry is 16:9 only:
`720` is 1280x720, `480` is 832x480. A clip is `1 + 4k` frames between 33 and
121 (the VAE compresses time 4x). Control videos are decoded with PyAV, center
cropped, resampled to the clip's frame count and resized in
[`control.py`](./control.py).

Prompts are upsampled before sampling. Cosmos 3 was trained on structured JSON
captions, so [`upsampler.py`](./upsampler.py) expands a one-line idea into the
upstream schema through the NVIDIA API Catalog chat endpoint, trying each model
in `UPSAMPLER_MODELS` in turn. If every model fails, the plain prompt is used
with the pipeline's templates and the task records `upsampler: "none"`, so a
result always says which path produced it. The Cosmos guardrail is disabled on
this lane by owner directive (`/health` reports `guardrail: false`).

## Job lifecycle

```
queued -> upsampling -> generating -> decoding -> encoding -> done
                                                          \-> failed (error_code + error)
```

Every state transition is written to `gs://$TASK_BUCKET/$TASK_PREFIX/<id>.json`,
so a poll survives a page reload, an API redeploy, or a poll that lands on a
fresh instance. The running job heartbeats every `HEARTBEAT_SECS`; a record that
stops heartbeating for `ORPHAN_AFTER_SECS` (the instance died) is failed as
`worker_restarted`. A job that passes `JOB_TIMEOUT_SECS` fails as `timeout`.

While the checkpoint is still loading, queued tasks carry `detail: "model
loading"` and wait (up to 900 s) for the model rather than failing. The detail
persists in the record afterwards, so consumers only honor it while `status` is
`queued`.

Failure codes: `bad_image`, `bad_control_video`, `gpu_oom`, `timeout`,
`worker_restarted`, `generation_failed`. The input-shaped ones carry a
caller-safe message; everything else is reduced by `worker_security.safe_error`.

## Endpoints

All routes except `GET /` and `GET /health` need
`Authorization: Bearer $API_KEY`.

### `POST /infer` returns `202`

```json
{ "mode": "depth", "prompt": "a rain-soaked neon alley at night",
  "resolution": "720", "num_frames": 121, "seed": 7,
  "control_video": "data:video/webm;base64,..." }
```

`image` mode takes `"image": "data:image/jpeg;base64,..."` instead. Response:
`{ "task_id", "status": "queued", "queue_position", "model": "cosmos3-nano" }`.
A full queue (`MAX_QUEUE`) answers 429; a malformed request answers 400 with a
message that can be shown as-is.

### `GET /tasks/{id}`

The task record: `status`, `detail`, `step`, `total_steps`, `progress` (0..1),
`eta_seconds`, `upsampler`, and on completion `timings`
(`upsample_s`, `control_s`, `sample_s`, `encode_s`, `total_s`) plus the clip's
frame count and fps.

### `GET /tasks/{id}/video`

The finished MP4 (H.264). The API copies it to R2 at
`forge/cosmos/<job_id>.mp4` on the first poll that sees `done`, so browsers
never talk to this service.

### `GET /health`

Load state (`ready`, `load_seconds`, `load_attempts`, `load_error`), `gpu_name`,
checkpoint `revision`, supported modes, resolutions and frame range, upsampler
configuration, `queue_depth`, `busy`, and `storage` (`gcs` or `local`). Answers
503 when the model failed to load after `MODEL_LOAD_ATTEMPTS`.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `API_KEY` | required | Bearer key for every non-health route (secret `cosmos-worker-key`) |
| `MODEL_DIR` | `/weights/cosmos3-nano` | Checkpoint directory (gcsfuse mount of the weights bucket) |
| `TASK_BUCKET` | empty | GCS bucket for durable task records and clips; empty means local disk |
| `TASK_PREFIX` | `cosmos-worker` | Object prefix inside `TASK_BUCKET` |
| `LOCAL_TASK_DIR` | `/tmp/cosmos-tasks` | Local store when no bucket is set |
| `DEFAULT_RESOLUTION` | `720` | Resolution when a request names none |
| `MAX_QUEUE` | `4` | Queued plus running tasks before 429 |
| `HEARTBEAT_SECS` | `20` | Running-task heartbeat interval |
| `ORPHAN_AFTER_SECS` | `240` | Silence after which a running task is failed as `worker_restarted` |
| `JOB_TIMEOUT_SECS` | `1500` | Hard ceiling on one job |
| `MODEL_LOAD_ATTEMPTS` | `3` | Checkpoint load retries before `/health` reports a load error |
| `MODEL_LOAD_RETRY_BASE_S` | `20` | Backoff base between load attempts |
| `NVIDIA_API_KEY` | empty | API Catalog key for prompt upsampling (secret `nvidia-api-key`) |
| `UPSAMPLER_MODELS` | `nemotron-3.5-super-vl-120b-a12b`, then `nemotron-3-nano-omni-30b-a3b-reasoning` | Upsampler models, tried in order |
| `UPSAMPLER_ENDPOINT` | API Catalog chat completions | OpenAI-compatible endpoint for upsampling |

The API side needs `COSMOS_WORKER_URL` and `COSMOS_WORKER_KEY`
([`api/_lib/env.js`](../../api/_lib/env.js)).

## Deploy

Weights are staged once (about 35 GB) into `gs://three-ws-model-weights-euw4/cosmos3-nano`
by [`cloudbuild.stage.yaml`](./cloudbuild.stage.yaml) (which runs
[`stage_weights.sh`](./stage_weights.sh)) and mounted read-only, so the image
stays small. Build and deploy:

```bash
TMPDIR=/home/user/.cache/gcloud-tmp gcloud builds submit workers/model-cosmos \
  --config workers/model-cosmos/cloudbuild.yaml \
  --project aerial-vehicle-466722-p5 --region us-central1 \
  --substitutions=SHORT_SHA=$(git rev-parse --short HEAD)
```

The service runs with min 0 and max 1 instances, concurrency 8, a 900 s request
timeout, 20 vCPU and 80 GiB, as `avatar-reconstruction-sa`. Scaling to zero
means the first world after an idle period pays the checkpoint load (about
7 minutes on the RTX PRO 6000). The page shows that as "Warming the GPU", and
the client's polls keep the instance alive through the load. Set
`_MIN_INSTANCES=1` in the build substitutions if the lane needs instant starts.

## Tests

```bash
cd workers/model-cosmos
python -m pytest -q test_generation_config.py test_control.py test_upsampler.py test_app_contract.py
```

`test_app_contract.py` boots the FastAPI app against a missing checkpoint to
cover auth, the load-failure health state, refusal while the model is down,
orphan recovery and failure classification without a GPU. The live
lane is checked end to end with `node scripts/verify-nvidia-cosmos.mjs`.
