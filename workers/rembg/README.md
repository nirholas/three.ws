# rembg: background removal service

FastAPI service that **strips the background from an image and returns a
transparent PNG**. It wraps the [`rembg`](https://github.com/danielgatis/rembg)
library (MIT) and its ONNX salient-object-detection models: `u2net`,
`isnet-general-use`, `u2net_human_seg`, `silueta`, and
[`birefnet-general-lite`](https://github.com/ZhengPeng7/BiRefNet) (MIT). The
default model is `isnet-general-use`; the legacy aliases `rmbg2` and `isnet`
resolve to it, so older callers keep working, and `birefnet` is the short name
for the BiRefNet tier. Every mesh backend reconstructs better geometry from
a cleanly cut-out subject, so this runs ahead of the image-to-3D models (except
[model-triposg](../model-triposg/), which removes backgrounds in-process).

**No GPU required.** Inference runs on ONNX Runtime's CPU provider: about 1 s
per removal with `u2net` and 2 s with `isnet-general-use` at 640px, and about
2.3 s for `isnet-general-use` on a 12 MP photo (measured on 2 cores; the
deployed service has 4). Only the default model is warmed at startup; the others
load lazily on first use, so cold starts stay fast.

Work is asynchronous: `POST /remove` returns `202` with a `task_id`; poll
`GET /tasks/{id}` until the PNG is written to
`gs://$GCS_BUCKET/rembg/{task_id}.png` and served back as an
`https://storage.googleapis.com/…` URL.

## Endpoints

`POST /remove` and `GET /tasks/{id}` require `Authorization: Bearer $API_KEY`;
a missing or wrong one is a `401`. `GET /health` is unauthenticated.

### `POST /remove` → `202`

Request (`RemoveRequest`):

```json
{
	"image": "https://three.ws/avatars/thumbs/default.png",
	"model": "rmbg2"
}
```

- `image`: a single `data:image/…;base64,…` URI or an `https://` URL (**required**).
  `https` sources go through the SSRF guard in
  [`worker_security.py`](./worker_security.py) (https-only; private, loopback,
  link-local, and cloud-metadata IPs rejected on every redirect hop; response
  capped at 16 MiB). The fetch identifies itself as
  `three.ws-rembg/1.0 (background removal worker; +https://three.ws)`, which is
  what hosts like Wikimedia require before they will serve a bot.
- `model`: optional, default `"rmbg2"`. One of `u2net`, `isnet-general-use`,
  `u2net_human_seg`, `silueta`, `birefnet-general-lite`, or the aliases
  `rmbg2` / `isnet` (which resolve to `isnet-general-use`) and `birefnet`
  (which resolves to `birefnet-general-lite`). Unknown names fall back to the
  default model. Pick `u2net_human_seg` for people: it is trained on human
  matting. Pick `birefnet` when the edge is the point: see
  [Choosing a model](#choosing-a-model).

### Choosing a model

| Model | Weights | One 677x1024 removal | Use it for |
|---|---|---|---|
| `isnet-general-use` (default, alias `rmbg2` / `isnet`) | 170 MB | 1.0 s | Everything by default. Fast, and good enough for a hard-edged subject |
| `u2net` | 168 MB | ~1 s | The older general model, kept for callers that pinned it |
| `u2net_human_seg` | lazy download | ~1 s | People, when you want a body silhouette rather than the most salient object |
| `silueta` | lazy download | ~1 s | A small-footprint U2Net variant |
| `birefnet-general-lite` (alias `birefnet`) | 214 MB, lazy download | 6.0 s | Hair, fur, foliage, thin straps: any soft or wispy boundary the DIS/U2Net family turns into a halo |

The two exact figures (1.0 s and 6.0 s) were measured on this repo's pinned
`onnxruntime==1.28.0` with ONNX Runtime capped to 4 threads, matching the
deployed service's 4 vCPUs, best of three runs on a warm session at 677x1024.
The `~1 s` rows are the U2Net-family figures this README already documented
above and were not re-measured.

Why the tier exists: every image-to-3D lane reconstructs geometry from the
matted subject, so a halo of leftover background around the hair becomes real
polygons in the mesh. BiRefNet's bilateral reference architecture keeps that
boundary, which is worth six seconds on a hero image and is not worth it on a
batch. It stays opt-in for exactly that reason, and the policy tests pin the
default so a future edit cannot promote it silently.

Response (the returned `model` is the resolved canonical name):

```json
{ "task_id": "3f2c…", "status": "queued", "model": "isnet-general-use" }
```

EXIF orientation is honored, so a phone photo comes back the way up its owner
took it rather than on its side.

### `GET /tasks/{task_id}`

`status` is one of `queued` → `running` → `done`, or `failed`.

```json
{
	"task_id": "3f2c…",
	"status": "done",
	"model": "isnet-general-use",
	"result_url": "https://storage.googleapis.com/three-ws-avatar-reconstructions/rembg/3f2c….png",
	"width": 1024,
	"height": 1024,
	"elapsed_ms": 2480
}
```

Unknown ids return `404`. A failure carries an `error` string: when the fault is
in the submitted image (a URL that 404s or 403s, a file that is not an image, a
data URI that is not valid base64) the message says exactly that, so the caller
can fix their input. Anything else returns an opaque
`internal error (ref <id>)`, with the full traceback and matching id in this
service's logs.

Every task is also written to `gs://$GCS_BUCKET/rembg/tasks/{task_id}.json`
([`task_store.py`](task_store.py)) when it is queued and again when it finishes.
A poll that lands on an instance that does not hold the task in memory (another
instance after scale-out, a fresh revision after a deploy, or the instance that
forwarded the job to the Triton GPU lane) is answered from that record, so a job
never 404s just because the poll was routed elsewhere. In memory a finished task
stays for an hour and the map is capped at 2000 entries (oldest finished evicted
first, never one still queued or running); the GCS record outlives both.

### `GET /health`

```json
{
	"ok": true,
	"service": "rembg",
	"gpu_available": false,
	"execution_providers": ["AzureExecutionProvider", "CPUExecutionProvider"],
	"models_loaded": ["isnet-general-use"],
	"models_available": ["u2net", "isnet-general-use", "u2net_human_seg", "silueta", "birefnet-general-lite"],
	"default_model": "isnet-general-use",
	"tasks_tracked": 0,
	"task_retention_s": 3600.0,
	"max_tasks": 2000
}
```

`models_loaded` vs `models_available` shows the lazy-load state.
`execution_providers` is what ONNX Runtime offers in this build, and
`gpu_available` is true only when one of them is an accelerator.

## Environment

| Var | Required | Default | Purpose |
|---|---|---|---|
| `API_KEY` | yes | none | Shared bearer secret (Secret Manager `avatar-reconstruction-key`) |
| `GCS_BUCKET` | yes | none | Cloud Storage bucket for output PNGs (`three-ws-avatar-reconstructions`) |
| `MODEL` | no | `isnet-general-use` | Startup default model, resolved through the alias table (prod sets `rmbg2`, which resolves to `isnet-general-use`) |
| `MAX_CONCURRENT` | no | `4` | In-flight removals allowed at once (CPU-bound, so several fit) |
| `INFERENCE_BACKEND` | no | `onnxruntime` | `onnxruntime` runs the model in-process; `triton` sends every model call to the local Triton server (set by `Dockerfile.triton`) |
| `TRITON_FORWARD_URL` | no | none | Base URL of the Triton GPU lane (`rembg-triton`). Only read by the CPU front door |
| `TRITON_FORWARD_PERCENT` | no | `0` | Share of `POST /remove` calls (0 to 100) the front door hands to the GPU lane. A failed hand-off runs the job locally |
| `TRITON_GRPC_URL` | no | `127.0.0.1:8001` | Triton gRPC endpoint (triton backend only) |
| `METRICS_PROJECT`, `METRICS_LOCATION` | no | none | When both are set, the triton backend exports Triton's counters to Cloud Monitoring every 60 s |

Weights for the two startup-capable models are **baked into the image** at build
time (the Dockerfile pre-caches `u2net` and `isnet-general-use` into
`/root/.u2net/`), so no GCS weights volume is mounted and cold starts do not hit
the network. `u2net_human_seg`, `silueta` and `birefnet-general-lite` download on
first request; BiRefNet's weights are 214 MB, so its very first call on a fresh
instance pays that download once before it answers.

## Triton GPU lane

The same app also ships as a second image, [`Dockerfile.triton`](Dockerfile.triton),
built on NVIDIA Triton Inference Server (`nvcr.io/nvidia/tritonserver:25.10-py3`).
It serves all five models from [`model_repository/`](model_repository/) on one
L4 with **dynamic batching**: concurrent jobs on the default model are stacked
into one GPU execution instead of queueing behind each other. rembg's own pre-
and post-processing is untouched; only the ONNX session is swapped for
[`triton_backend.TritonInnerSession`](triton_backend.py), which speaks the same
two calls rembg makes (`get_inputs()` and `run()`). Callers see the identical
HTTP contract.

| Model | Batch dim | `max_batch_size` | Preferred batches | Instances |
|---|---|---|---|---|
| `isnet-general-use` | dynamic | 8 | 2, 4, 8 | 2 |
| `u2net`, `u2net_human_seg` | dynamic | 16 | 2, 4, 8, 16 | 1 |
| `silueta`, `birefnet-general-lite` | static (exported at batch 1) | 0 | none | 1 |

All run `KIND_GPU` with a 4 ms batching window and a warmup request so the
first real job does not pay CUDA graph and cuDNN autotune setup.
[`export_triton_models.py`](export_triton_models.py) rewrites the upstream
weights for Triton (single output, symbolic batch dimension) and refuses to
write a model whose output drifts more than 1e-4 from the upstream file.

**Routing.** `rembg-service` (CPU, us-central1) stays the only front door.
`TRITON_FORWARD_URL` + `TRITON_FORWARD_PERCENT` decide which share of submits it
hands to `rembg-triton` ([`forwarder.py`](forwarder.py)); the GPU lane writes
the result and the task record to the same bucket, so the caller's poll
against the front door finds it. Any hand-off failure (timeout, 5xx, a bad
reply) runs the job on the local CPU path instead, so the GPU lane can never
fail a job the CPU lane would have finished. `/health` reports the split and
the forwarded and fallback counters.

**Metrics.** On the GPU lane a background thread scrapes Triton's Prometheus
endpoint every minute and writes `custom.googleapis.com/triton/*` to Cloud
Monitoring (resource `generic_task`, namespace `rembg-triton`): per model
`requests_per_min`, `executions_per_min`, `avg_batch_size`, `avg_queue_ms`,
`avg_compute_ms`, `failures_per_min`, plus `gpu_utilization` and GPU memory.

Parity against the ONNX Runtime CPU lane is enforced at build time by
[`build_gate_triton.sh`](./build_gate_triton.sh) and
[`test_triton_parity.py`](./test_triton_parity.py): real photos are cut out
through both and the masks must match. Live throughput and latency are the
Cloud Monitoring metrics above.

## Run locally

`rembg` is pip-installable and runs on CPU, so no GPU is needed:

```bash
cd workers/rembg
pip install -r requirements.txt
API_KEY=dev-secret GCS_BUCKET=your-dev-bucket \
	uvicorn main:app --host 0.0.0.0 --port 8080
```

Or the exact production image:

```bash
docker build -t rembg-service workers/rembg
docker run --rm -p 8080:8080 \
	-e API_KEY=dev-secret \
	-e GCS_BUCKET=your-dev-bucket \
	-e GOOGLE_APPLICATION_CREDENTIALS=/gcp/sa.json \
	-v /path/to/sa.json:/gcp/sa.json:ro \
	rembg-service
```

## Tests

```bash
python3 workers/rembg/test_rembg_policy.py    # request policy, stdlib only
python3 workers/rembg/test_task_store.py      # GCS task records
python3 workers/rembg/test_forwarder.py       # GPU-lane hand-off and fallback
API_KEY=x GCS_BUCKET=x python3 workers/rembg/test_rembg_smoke.py   # real cutout
API_KEY=x GCS_BUCKET=x python3 workers/rembg/test_task_routes.py   # routes, polls across instances
python3 workers/rembg/test_triton_metrics.py  # Triton metrics math
```

[`test_triton_parity.py`](test_triton_parity.py) is the GPU image's gate: the
`Dockerfile.triton` build starts a real Triton server on CPU, cuts real
portraits out through it and through rembg's own ONNX Runtime session, requires
matching masks for every model, then fires 8 concurrent jobs and requires the
dynamic batcher to have stacked them without changing any output.

[`test_rembg_policy.py`](test_rembg_policy.py) covers the pure rules in
[`rembg_policy.py`](rembg_policy.py): model-alias resolution and the task
retention policy. It needs nothing but the standard library.
[`test_rembg_smoke.py`](test_rembg_smoke.py) is the core-path test: it cuts a
subject out with both baked-in models and asserts the corners came back
transparent and the subject opaque, plus that bad input is rejected with a
caller-readable reason. It needs `requirements.txt` and the weights, but no GPU,
no network and no GCP credentials.

The CPU image runs these inside `docker build` as a gate, so an image that cannot remove a
background does not get pushed.

## Deploy

Submit from the **repo root**: the build step declares `dir: workers/rembg`, so
the upload source is the whole repo.

```bash
gcloud builds submit --config workers/rembg/cloudbuild.yaml . \
	--region us-central1 --project aerial-vehicle-466722-p5 \
	--substitutions=SHORT_SHA=manual$(date +%s)
```

Deploys Cloud Run service **`rembg-service`** in `us-central1`: **CPU only** (no
GPU), 4 vCPU, 8 GiB, 60 s request timeout, `min-instances=1` (kept warm, see the
rationale in [`cloudbuild.yaml`](cloudbuild.yaml)), `max-instances=4`. Env is set
to `MODEL=rmbg2`, `MAX_CONCURRENT=4`; `API_KEY` comes from the
`avatar-reconstruction-key` secret. `SHORT_SHA` is only substituted automatically
for trigger builds, hence the explicit value on a manual submit.

The Triton GPU lane builds from the worker directory:

```bash
TMPDIR=/home/user/.cache/gcloud-tmp gcloud builds submit workers/rembg \
	--config workers/rembg/cloudbuild.triton.yaml \
	--region us-central1 --project aerial-vehicle-466722-p5 \
	--substitutions=SHORT_SHA=manual$(date +%s)
```

It deploys **`rembg-triton`** in `europe-west1` (1x NVIDIA L4, 8 vCPU, 32 GiB,
min 1, max 2). europe-west1 because the us-central1 and us-east4 L4 quota is
held by the 3D model lanes. Point the front door at it with a config-only
update (`--update-env-vars`, never `--set-env-vars`):

```bash
gcloud run services update rembg-service --region us-central1 \
	--update-env-vars TRITON_FORWARD_URL=https://rembg-triton-93741856042.europe-west1.run.app,TRITON_FORWARD_PERCENT=100
```

## Example: submit, poll, fetch

```bash
BASE=https://rembg-service-93741856042.us-central1.run.app
KEY=$(gcloud secrets versions access latest --secret=avatar-reconstruction-key \
	--project aerial-vehicle-466722-p5)

TASK=$(curl -s -X POST "$BASE/remove" \
	-H "Authorization: Bearer $KEY" \
	-H 'Content-Type: application/json' \
	-d '{"image":"https://three.ws/brand/three-ws-mark.png","model":"u2net_human_seg"}' \
	| python3 -c 'import sys,json; print(json.load(sys.stdin)["task_id"])')

while :; do
	STATE=$(curl -s "$BASE/tasks/$TASK" -H "Authorization: Bearer $KEY")
	echo "$STATE"
	echo "$STATE" | grep -q '"status": *"done"' && break
	echo "$STATE" | grep -q '"status": *"failed"' && exit 1
	sleep 2
done

curl -s "$BASE/tasks/$TASK" -H "Authorization: Bearer $KEY" \
	| python3 -c 'import sys,json; print(json.load(sys.stdin)["result_url"])'
```

## How three.ws calls it

The platform points **`GCP_REMBG_URL`** at this service. It is wired in
[`api/_providers/gcp.js`](../../api/_providers/gcp.js) as the `rembg` mode and
invoked by [`api/forge-rembg.js`](../../api/forge-rembg.js), the `/forge`
background-removal feature (which errors clearly when `GCP_REMBG_URL` +
`GCP_RECONSTRUCTION_KEY` are unset). It shares the platform-side bearer secret
`GCP_RECONSTRUCTION_KEY`, which must equal this service's `API_KEY`.
