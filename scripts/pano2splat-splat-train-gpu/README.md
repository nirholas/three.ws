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
