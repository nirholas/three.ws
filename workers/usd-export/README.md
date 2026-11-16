# usd-export: Forge GLB to simulation-ready OpenUSD

Turns any Forge model (a GLB) into a validated OpenUSD package that opens in
NVIDIA Omniverse and Isaac Sim with physics already set up:

- **`asset.usd`** (binary crate), **`asset.usda`** (text, diff-able),
  **`asset.usdz`** (single-file package with textures), **`asset.zip`**
  (`asset.usd` plus its `textures/` folder), and **`report.json`** (everything
  below, including every validator finding).
- **Geometry and materials**: glTF meshes become `UsdGeom.Mesh` with normals,
  UVs and vertex colours; PBR materials become `UsdPreviewSurface` networks with
  their textures. glTF is Y-up meters, the stage is Z-up meters
  (`metersPerUnit = 1`, `upAxis = Z`), and the model stands on the ground at
  the origin.
- **Physics**: [CoACD](https://github.com/SarahWeiii/CoACD) (MIT) convex
  decomposition of the visual mesh, authored as `UsdPhysics` collision meshes
  (`MeshCollisionAPI` approximation `convexHull`), a `RigidBodyAPI` on the root,
  a `PhysicsMaterialAPI` (friction, restitution) and a `MassAPI` whose mass is
  hull volume times a density chosen from the prompt's object class. The method
  is written into the asset metadata and `report.json`.
- **Semantics**: a class label (`chair`, `vehicle`, `robot`, ...) from the
  prompt, applied with `UsdSemantics` labels and Isaac's `semanticLabel`
  attribute so synthetic-data annotators pick it up.
- **Skeletons**: a rigged GLB becomes a `UsdSkel` SkelRoot with one Skeleton per
  skin, joint bindings and weights, blend shapes, and one shared
  `SkelAnimation` per joint topology. Rigged assets are kinematic bodies.
- **Validation**: every file is checked with OpenUSD's `UsdValidation`
  framework (the engine behind `usdchecker` in OpenUSD 26) and NVIDIA's
  [omniverse-asset-validator](https://pypi.org/project/omniverse-asset-validator/)
  (Apache-2.0). Any error fails the job; warnings are recorded in the report.

CPU only. A FastAPI service on Cloud Run: jobs answer `202` immediately and run
in a background task.

## API

All routes except `/health` need `Authorization: Bearer $API_KEY`.

```
POST /export
  { glb_url, prompt?, category?, label?, size_m?, density_kg_m3?, creation_id? }
  -> 202 task record   (200 with the finished record on a cache hit)

GET /tasks/{task_id}
  -> { task_id, status: queued|running|done|error, stage, stages,
       files?: { usd, usda, usdz, zip, report }, summary?, error? }

GET /health -> { ok, service, exporter, openusd }
```

Stages, in order: `fetching`, `converting`, `physics`, `packaging`,
`validating`, `uploading`. Task ids are a hash of the request and the exporter
version, and the record lives in GCS at `usd/<task_id>/status.json`, so a
repeat request is a cache hit and any instance can answer a poll. Output files
are public under `https://storage.googleapis.com/$GCS_BUCKET/usd/<task_id>/`.

The platform calls this worker through
[`api/forge/export-usd.js`](../../api/forge/export-usd.js), which resolves a
creation id, guards caller URLs and holds the key. Do not call it from a
browser.

## Environment

| Variable | Meaning |
|---|---|
| `API_KEY` | bearer secret (Secret Manager `avatar-reconstruction-key`) |
| `GCS_BUCKET` | output bucket (`three-ws-avatar-reconstructions`) |
| `MAX_CONCURRENT` | parallel exports per instance (default 2) |
| `GLTFPACK_BIN` | gltfpack binary used to decode meshopt GLBs (set in the image) |

## Files

| File | Role |
|---|---|
| `main.py` | FastAPI service, task records, GCS upload |
| `export.py` | the pipeline: scale policy, stages, report; also a CLI (`python export.py in.glb out/`) |
| `gltf_reader.py` | GLB parser (refuses Draco with a clear message) |
| `gltf_to_usd.py` | UsdGeom, UsdShade and UsdSkel authoring |
| `physics.py` | CoACD hulls, volume, mass and inertia, UsdPhysics authoring |
| `semantics.py` | prompt classifier, class table (label, group, density, typical size) |
| `validate.py` | UsdValidation and omniverse-asset-validator runs |
| `gltf_meshopt.py`, `worker_security.py` | vendored shared modules (`npm run check:vendored`) |
| `test_export.py` | build-time gate (runs in the Dockerfile) |
| `bench.py` | export real Forge creations, locally or through the deployed service |
| `drop_test.py` | physics drop test in Newton (not shipped in the image) |

## Test

```
python test_export.py                       # 12 tests, both validators, about 15 s
USD_EXPORT_KEY=... python bench.py --worker https://usd-export-service-lp642k3kpa-uc.a.run.app \
  --json ../../docs/openusd-export/bench-results.json
pip install newton warp-lang && python drop_test.py out/asset.usd
```

## Deploy

```
TMPDIR=/home/user/.cache/gcloud-tmp gcloud builds submit \
  --config workers/usd-export/cloudbuild.yaml --substitutions SHORT_SHA=$(git rev-parse --short HEAD) .
```

Cloud Build runs `test_export.py` inside the image build, so a regression never
reaches Cloud Run. The API service reads the worker from `GCP_USD_EXPORT_URL`.
Full write-up: [`docs/openusd-export.md`](../../docs/openusd-export.md).
