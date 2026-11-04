# model-lhm

DEV-ONLY worker for [LHM](https://github.com/aigc3d/LHM) (Large Animatable Human Reconstruction Model): one full-body photo to an animatable 3D Gaussian human (`.ply`). It is **not wired to any platform route, UI or render path, and must not be deployed for production use** because of the licence verdict below.

## License (read 2026-11-04)

| Component | Licence | Source read | Commercial use |
| --- | --- | --- | --- |
| LHM code | Apache-2.0 | https://api.github.com/repos/aigc3d/LHM/license | yes |
| `3DAIGC/LHM-500M-HF` weights | apache-2.0 (HF tag) | https://huggingface.co/3DAIGC/LHM-500M-HF | yes |
| `3DAIGC/LHM-MINI` weights | no licence declared | HF model card | no (undeclared) |
| SMPL-X body model (inside `LHM_prior_model.tar`, required by every inference path) | non-commercial scientific research only; commercial use needs a Meshcapade licence | https://smpl-x.is.tue.mpg.de/modellicense.html | **no, blocks** |
| Meta Sapiens (inside the same tar) | Sapiens licence (GitHub reports NOASSERTION; treated as non-commercial until confirmed) | https://github.com/facebookresearch/sapiens | likely no |
| SAM2 (inside the same tar) | Apache-2.0 | https://github.com/facebookresearch/sam2 | yes |

Verdict: LHM's own code and weights are permissive, but the mandatory prior bundle includes SMPL-X, so a hosted photoreal selfie lane cannot launch commercially until a Meshcapade SMPL-X commercial licence (smpl@max-planck-innovation.de) is obtained and Sapiens is cleared. Until then the worker exists for internal evaluation only. Owner action: obtain the licence, then follow "Promoting to production" below.

## Contract

Same task shape as `model-triposplat`.

- `POST /infer` `{ images: [data-uri|https url], model?: "LHM-500M-HF"|"LHM-1B-HF", job_id? }` returns 202 `{ task_id, status }`. Bearer `API_KEY` required.
- `GET /tasks/{id}` returns `{ status, result_gcs_url, ply_url, elapsed_ms, error, error_kind }`. Tasks persist to `tasks/lhm/<id>.json` in `GCS_BUCKET`.
- `GET /health` returns 503 once the weight load has failed permanently. `GET /` is an unauthenticated descriptor with `dev_only: true`.
- Image fetches go through the SSRF-hardened `worker_security.py` (vendored, byte-identical across workers; `npm run check:vendored`).

## Environment

`API_KEY`, `GCS_BUCKET`, `WEIGHTS_BUCKET` (default `three-ws-model-weights`), `WEIGHTS_PREFIX` (default `lhm`), `LOCAL_WEIGHTS_DIR` (default `/opt/LHM`, mirrors the upstream checkout layout), `MAX_CONCURRENT`, `MODEL_LOAD_ATTEMPTS`.

## Run

```bash
python3 test_lhm_prep.py                                   # CPU-only input/output guard, also a Docker build step
./stage-assets.sh /path/to/LHM_prior_model.tar            # you must accept the SMPL-X licence to obtain the tar
gcloud builds submit --config cloudbuild.yaml ../..        # dev service, GPU L4, auth required
```

The Dockerfile sets `TORCH_CUDA_ARCH_LIST=8.9` for the L4. Inference shells out to the upstream CLI (`python -m LHM.launch infer.human_lrm ... export_mesh=True`) so upstream preprocessing is used unmodified. The GPU path has not been exercised in this repo (no weights are staged and the prior tar needs a licence acceptance); only the CPU-side guard test has run.

## Promoting to production

Not done, by design. After the licence is cleared: add `api/forge-lhm.js` mirroring `api/forge-splat.js`, a Forge UI entry, and an animation/render path for the Gaussian human (orders 744 tasks 4 to 6 in `prompts/finish/`).
