# model-pano2splat

GPU worker that turns 360 capture (raw Insta360 .insv/.insp or ready equirect video or photos) into a Gaussian splat.

Stages, each a Python package with its own README and a CLI run by `pipeline.py`:

- [pano_stitch/](pano_stitch/README.md): raw Insta360 files to level equirect video or photo (`python -m pano_stitch`).
- [pano_sfm/](pano_sfm): structure from motion on equirect frames.
- [splat_train/](splat_train): Gaussian splat training.

Service shell: `main.py` (HTTP entry), `health.py`, `stages.py`, `results.py`, `source_fetch.py`, `worker_security.py`. One GPU image is built by `Dockerfile` through `cloudbuild.yaml`; `cloudbuild.verify.yaml` and `verify.py` prove it. Per-stage Python pins live in `requirements.d/`, test footage manifest in `fixtures/MANIFEST.md`, tests in `tests/`.
