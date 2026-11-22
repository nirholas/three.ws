# splat_train GPU measurement harness

Measures `workers/model-pano2splat/splat_train` (contract C1 of the insta360 campaign) on a Cloud Run
L4 through a throwaway Cloud Run Job. The production image belongs to the worker itself (order 337);
nothing here deploys a service.

| File | Role |
|---|---|
| `Dockerfile` | CUDA 12.4 / Ubuntu 22.04 / Python 3.10 with torch 2.4.1+cu124, gsplat 1.5.3 and `requirements.d/splat_train.txt` |
| `cloudbuild.yaml` | Builds and pushes the image as `three-ws-build@` |
| `run.sh` | Job entrypoint. Task N trains matrix cell N (`dataset:iterations`) with `--preview-video` and copies every output plus `gpu.txt`, `stdout.jsonl`, `stderr.log`, `exit.json` and `code.sha256` to the results bucket |
| `measure.sh` | `build`, `run`, `report RUN_ID`, `cleanup` |

## Run

```bash
scripts/pano2splat-splat-train-gpu/measure.sh build      # about 15 min, once per dependency change
scripts/pano2splat-splat-train-gpu/measure.sh run        # uploads the current package, runs the matrix, prints the table
scripts/pano2splat-splat-train-gpu/measure.sh cleanup    # deletes the job, the image and its repository
```

`run` uploads the working-tree `splat_train/` next to the results and `run.sh` swaps it in before
training, so code changes are measured without a rebuild; `code.sha256` in each result folder records
exactly which code ran. Overrides: `REGION` (default `europe-west4`, since us-central1 L4 quota is
held by production services), `MATRIX`, `PARALLELISM`, `EXTRA_ARGS`.

## Data

Inputs are read from `gs://three-ws-capture-fixtures` (mounted read only at `/fixtures`); results go to
`gs://three-ws-pano-captures/splat_train-measure/<RUN_ID>/<scene>-<iterations>/`.

| Fixture prefix | Source | License |
|---|---|---|
| `splat_train/mipnerf360/garden/` | Mip-NeRF 360 `garden`: 185 images (5187x3361) + COLMAP `sparse/0` | CC BY 4.0, Barron et al., [jonbarron.info/mipnerf360](https://jonbarron.info/mipnerf360/) |
| `splat_train/mipnerf360/counter/` | Mip-NeRF 360 `counter`: 240 images (3115x2076) + COLMAP `sparse/0` | CC BY 4.0, same source |

Both are registered in `gs://three-ws-capture-fixtures/insta360/MANIFEST.json` with byte counts and
a content digest (SHA-256 of the sorted per-file `sha256sum` listing).

## Measured: run 20261121T222338Z (2026-11-21, europe-west4, 1x L4 per cell)

Defaults throughout (`--max-image-side 1600`, SH degree 3, holdout every 8th image, `--preview-video`);
`gsplat` 1.5.3, torch 2.4.1+cu124. PSNR and SSIM are on held-out views never seen in training.

| scene | iterations | PSNR | SSIM | Gaussians | scene.ply | scene.spz | preview.mp4 | train s | splat_train s | billed L4 s |
|---|---|---|---|---|---|---|---|---|---|---|
| garden | 7000 | 26.46 | 0.833 | 2,999,708 | 743.9 MB | 61.4 MB | 86.5 MB | 980 | 1059 | 1406 |
| counter | 7000 | 28.03 | 0.915 | 2,996,983 | 743.3 MB | 56.2 MB | 29.0 MB | 1230 | 1296 | 1674 |
| garden | 30000 | 27.22 | 0.858 | 2,999,450 | 743.9 MB | 82.3 MB | 96.5 MB | 4155 | 4234 | 4606 |
| counter | 30000 | 29.46 | 0.929 | 2,998,829 | 743.7 MB | 74.8 MB | 31.3 MB | 5329 | 5403 | 5774 |

- Billed L4 seconds are task start to completion, including 253 to 287 s of copying the dataset off the
  gcsfuse mount and container start. The whole matrix used 13,460 L4-seconds (3.74 L4-hours).
- Peak GPU memory stayed between 3.95 and 4.5 GB, so an L4's 24 GB is far from the limit at the 3M cap.
- Every cell hit the 3M Gaussian cap, which is why `scene.ply` is about 744 MB in all four. SPZ is 12 to 13x
  smaller.
- Orientation: a 40k-splat subsample of garden-7000 `scene.spz` loaded in `/splat` with zero console
  errors and renders upright (lawn, table and vase seen from above after an orbit up). Full-size 3M-splat
  files cannot be rendered in headless swiftshader, so that check used the subsample.
- The `preview.mp4` sizes predate 2af5a586b, which capped the encoder at CRF 23 under a 12 Mbps VBV
  limit: the garden-7000 preview re-encodes to 30.0 MB (SSIM 0.922 against the file above).
- `scene.spz` is SPZ version 4 (spz v3.0.0 library); `/splat` reads it without changes.
