# avatar-sources/

Source data for avatar bases that are baked into shipped assets at build time. Nothing here is served directly.

| Directory | What it is |
|---|---|
| [anny/](anny/README.md) | CC0 parametric body data, baked into `public/avatars/parametric-base.glb` by `node scripts/build-parametric-base.mjs`. Provenance and license in its README and [LICENSE.md](anny/LICENSE.md). |
| [ict-facekit/](ict-facekit/README.md) | MIT ARKit expression model (USC ICT), vendored by `python3 scripts/vendor-ict-facekit.py` and transferred onto the Anny head by `scripts/build-ict-expression-targets.py`; baked into the reconstruction template by `node scripts/build-reconstruction-template.mjs`. License in [LICENSE](ict-facekit/LICENSE). |
