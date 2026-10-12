# model-triposplat: single image to 3D Gaussian splat (TripoSplat)

[TripoSplat](https://github.com/VAST-AI-Research/TripoSplat) (VAST-AI-Research,
MIT; weights also MIT, `VAST-AI/TripoSplat` on HuggingFace) decodes a single
image straight to a 3D Gaussian splat with a flow-matching diffusion model: no
intermediate mesh, no multi-view synthesis. The splat loads directly into the
[Splat Viewer](../../pages/splat.html) (`mountSplatScene`, `src/splat-stage.js`),
making this the first Forge lane whose output is a Gaussian splat rather than a
GLB mesh.

## Role in the pipeline

`model-triposplat` is a standalone image lane, not part of the avatar
reconstruction chain: it has no body-type conditioning and produces no
skeleton, so it never feeds the rigging stage the way `reconstruct`/`trellis`/
`hunyuan` do. It is reached through [`api/forge-triposplat.js`](../../api/forge-triposplat.js),
which the Forge Studio Lab's Splat tab calls, then hands the result straight to
the Splat Viewer's `mountSplatScene`.

The pipeline's own `rmbg_path` (BiRefNet) removes the input's background
in-process, so this worker does no matting of its own, unlike
[model-triposr](../model-triposr/) and [model-trellis](../model-trellis/).

## HTTP API

All routes require `Authorization: Bearer $API_KEY` except `/health`. Work is
asynchronous: `/infer` returns immediately with a `task_id`, and you poll
`/tasks/:id` until `status` is `done` or `failed`.

### `POST /infer` → `202`

```bash
curl -X POST "$SERVICE_URL/infer" \
  -H "Authorization: Bearer $API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"images":["https://three.ws/avatars/thumbs/default.png"],"num_gaussians":131072}'
# → { "task_id": "…", "status": "queued", "model": "triposplat" }
```

Request body:

| Field | Type | Notes |
|---|---|---|
| `images` | string[] (1-6) | `https://` URLs or `data:image/…` URIs. Only the first is used. Remote URLs pass through the SSRF guard in [`worker_security.py`](./worker_security.py). |
| `num_gaussians` | integer, optional | Clamped to 16384-262144 (the range the upstream examples exercise). Defaults to 131072. More gaussians cost more decode time, not more sampling time: the denoiser runs once regardless. |
| `seed` | integer, optional | Forwarded to the pipeline when set; otherwise its own default applies. |

### `GET /tasks/:id`

```json
{ "task_id": "…", "status": "done", "result_gcs_url": "https://storage.googleapis.com/…/t.splat", "num_gaussians": 131072, "bytes": 4194304, "elapsed_ms": 18340 }
```

`result_gcs_url` points at a `.splat` file: 32 bytes per splat (position,
scale, RGBA, quaternion), the same format `src/splat-stage.js` already loads
through Spark's `SplatMesh`.

### `GET /health`

```json
{ "ok": true, "model": "triposplat", "gpu_available": true, "gpu_name": "NVIDIA L4", "model_loaded": true }
```

## Weight staging

Five safetensors files, staged into the shared weights bucket the same way as
every other self-hosted worker (see [model-triposr](../model-triposr/)'s
README for the general pattern):

```bash
pip install huggingface_hub
huggingface-cli download VAST-AI/TripoSplat --local-dir /tmp/triposplat
gsutil -m cp -r /tmp/triposplat gs://three-ws-model-weights/triposplat/
```

`WEIGHTS_DIR` (default `/weights/triposplat`) must then contain:

```
diffusion_models/triposplat_fp16.safetensors
vae/triposplat_vae_decoder_fp16.safetensors
vae/flux2-vae.safetensors
clip_vision/dino_v3_vit_h.safetensors
background_removal/birefnet.safetensors
```

## Deploy

```bash
gcloud builds submit --config workers/model-triposplat/cloudbuild.yaml .
```

Owner-gated: builds and deploys are never run from this worktree's unattended
sessions. See `prompts/finish/_context/production-100-OWNER-ACTIONS.md` for the
pending row.

## License

TripoSplat's code and model weights are both MIT-licensed (confirmed from the
repository's own `LICENSE` file). `$THREE` is unrelated to this worker; nothing
here references any other crypto project.
