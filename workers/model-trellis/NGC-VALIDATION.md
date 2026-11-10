# TRELLIS image: NGC validation record

Status (2026-11-10): validated. The two-stage candidate below passed its in-image
test gate, a Trivy scan with no CRITICAL findings, and real `POST /infer` runs on
an NVIDIA A100 (Ampere, `sm_80`) and an NVIDIA L4 (Ada, `sm_89`) that each
produced a textured GLB. H100 quota was requested and denied, so Hopper is
covered by the compiled `sm_90` code and PTX, not by a run. What remains is
owner-gated (see "Owner steps").

## The image that was validated

`us-central1-docker.pkg.dev/aerial-vehicle-466722-p5/model-trellis/server@sha256:f6634a81fa68a85de82179a96d67f8585ad09402ee0e2f3b3dc421a7acd3c5d2`

Built by Cloud Build `0d26c01f` from [cloudbuild.ngc.yaml](./cloudbuild.ngc.yaml)
with `TORCH_CUDA_ARCH_LIST=8.0;8.6;8.9;9.0+PTX`.

- Builder: `nvidia/cuda:12.6.3-devel-ubuntu24.04` compiles nvdiffrast,
  diffoctreerast and diff-gaussian-rasterization into a venv at `/opt/venv`.
- Final: `nvidia/cuda:12.6.3-runtime-ubuntu24.04` with only that venv, the
  TRELLIS source and the DINOv2 hub copy. No compiler, no CUDA toolkit headers.
- Stack: Python 3.12, torch 2.6.0+cu126 (carries its own cuDNN), xformers
  0.0.29.post3, spconv-cu126 2.3.8, kaolin 0.18.0, pillow 13, transformers 5.21.0,
  FastAPI 0.162 on Starlette 1.10.
- Build gate, run inside the final stage: 65 pytest cases (request policy,
  storage backend, instance health, tracing) passed, then
  `python3 /app/test_app_contract.py` passed all 29 contract assertions
  (TRELLIS import chain, auth boundary, dead-pipeline 503).

## Size and layers

| Image | Layers | Compressed size |
|---|---|---|
| Before: single-stage `sha256:8ad474da...` (CUDA 12.1 devel, Python 3.10) | 31 | 12,295,189,514 B (12.30 GB) |
| After: two-stage `sha256:f6634a81...` | 22 | 8,390,377,290 B (8.39 GB) |

3.9 GB (31.8%) smaller.

## Vulnerability scan

Trivy 0.58.1, HIGH and CRITICAL only, via [cloudbuild.scan.yaml](./cloudbuild.scan.yaml)
and [scan_summary.py](./scan_summary.py).

| Image | CRITICAL | HIGH | OS packages |
|---|---|---|---|
| Before (`8ad474da`) | 70 | 1437 | not broken out in that scan |
| Intermediate two-stage on CUDA 12.1 (`f516fe61`) | 11 | 59 | 0 |
| After (`f6634a81`, scan build `1d5a5e6c`) | **0** | **2** | **0** |

The intermediate scan showed every remaining finding was in Python packages we
pin: pillow 12.3 (10 critical, 46 high), torch 2.4 (1 critical), transformers
4.46, starlette 0.38, filelock, rembg, setuptools. Pillow 13 needs Python 3.11+
and torch below 2.6 carries CVE-2025-32434, so the image moved to Ubuntu 24.04,
Python 3.12 and torch 2.6, with each package pinned to a patched release.

The two HIGH findings left are upstream-only:

| Package | Finding | Why it stays |
|---|---|---|
| torch 2.6.0+cu126 | CVE-2026-24747, fixed in 2.10.0 | kaolin 0.18 and the xformers and spconv wheels this pipeline needs are built against torch 2.6; there is no published torch-2.10 build of them. |
| setuptools 70.3.0 | CVE-2025-47273, fixed in 78.1.1 | Not an installed package. It is the `pkg_resources` copy vendored inside pip, recorded in `pip/_vendor/vendor.txt` and `pip/_vendor/bom.cdx.json`. The installed setuptools is 84.2.1. pip 26.3 (latest, 2026-11-02) still vendors 70.3.0, and the vulnerable module (`package_index`) is not part of the vendored copy. |

## GPU validation

[scripts/ngc-validate-trellis.sh](../../scripts/ngc-validate-trellis.sh) creates a
spot GCE VM, copies `TRELLIS-image-large` to a local mount, runs the image with
`OUTPUT_DIR` mode (no `GCS_BUCKET`), waits for `/health` to report `ready`, posts
the bundled example image to `POST /infer` at the `standard` tier, polls
`/tasks/{id}`, downloads `GET /results/{task_id}.glb`, uploads the evidence to
`gs://three-ws-ngc-validation/<run>/`, and deletes the VM.

| GPU | Run | Driver | Infer time | GLB |
|---|---|---|---|---|
| A100-SXM4-40GB, compute 8.0 | `20261110-145819-a100` (us-central1-c) | 580.178.04 | 63.5 s | 7,875,000 B, 1 mesh, 55,943 triangles, 49,551 vertices, 1 material, 2048x2048 PNG texture |
| L4, compute 8.9 | `20261110-145825-l4` (us-central1-a) | 580.178.04 | 118.4 s | 7,904,908 B, 1 mesh, 57,289 triangles, 50,995 vertices, 1 material, 2048x2048 PNG texture |
| H100 | not run | | | `GPUS_PER_GPU_FAMILY` quota is 0; quota preference `ngc-trellis-h100-us-central1` was denied on 2026-11-10 |

Both `/health` responses reported `ready: true`, `load_error: null`,
`output_backend: local`. Both tasks reached `done`. Each GLB was loaded with
glTF-Transform (`NodeIO.read`), which parsed the mesh, material and texture:

- A100 result sha256 `99eae453a3a6329f7c6180d41cafbce95e4097e736ad0e0dce55d1d013c9f9a3`
- L4 result sha256 `96f11c950ab2956cdf55297f36f9fa57945c9605460ebd8fc25069c8a7b8015b`

No `ngc-validate-*` instance remains in `gcloud compute instances list`.

## Architecture matrix

`TORCH_CUDA_ARCH_LIST=8.0;8.6;8.9;9.0+PTX` for the NGC image:

- `8.0`: run on the A100.
- `8.9`: run on the L4.
- `8.6` (A10, RTX 30/A-series): compiled natively. `sm_80` code also runs on
  `sm_86` under CUDA's same-major binary compatibility.
- `9.0+PTX`: native `sm_90` for Hopper plus PTX that the driver JIT-compiles
  for newer GPUs. Not run, because H100 quota was denied.

The production default stays `8.9` (the Cloud Run L4 fleet).

## Reproduce

```bash
gcloud builds submit workers/model-trellis --project aerial-vehicle-466722-p5 \
  --region us-central1 --config workers/model-trellis/cloudbuild.ngc.yaml
gcloud builds submit workers/model-trellis --project aerial-vehicle-466722-p5 \
  --region us-central1 --config workers/model-trellis/cloudbuild.scan.yaml \
  --substitutions _IMAGE=<image@digest>
scripts/ngc-validate-trellis.sh --image <image@digest> --accel a100   # or l4, h100
```

## Owner steps

1. Submit the NGC partner intake form and sign the NGC Partner Legal Agreement.
2. Create the private repository `nvcr.io/<org>/trellis-mesh-server` and an NGC API key.
3. `NGC_API_KEY=... scripts/ngc-stage-trellis.sh --org <org> --version 1.0.0 --digest sha256:f6634a81fa68a85de82179a96d67f8585ad09402ee0e2f3b3dc421a7acd3c5d2 --yes-push`

Without `--yes-push` the stage script exits 2 and contacts nothing. Full detail
in [docs/nvidia-ngc-listing.md](../../docs/nvidia-ngc-listing.md#gate-4-the-ngc-partner-legal-agreement-and-the-staging-push).
