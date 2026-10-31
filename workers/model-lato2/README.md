# model-lato2

Artist-style low-poly retopology on an L4 GPU, using [LATO.2](https://github.com/LoHhhha/LATO.2) (Meshy, MIT code, MIT weights `0x4c48/LATO.2`). Mesh in, a clean triangle mesh of 200 to 5000 vertices out (about 400 to 10,000 faces).

It backs the **Artist mesh** topology of `POST /api/forge-gameready` ([api/forge-gameready.js](../../api/forge-gameready.js)).

## Why it is gated

LATO.2 is a generative sampler (V-Flow places vertices, T-Flow connects them), and upstream warns that outputs can contain holes. Every draw passes `lato_policy.gate_reason` before it is returned:

| Check | Limit | Reason code |
|---|---|---|
| Fewer than 100 faces | reject | `too_few_faces` |
| Boundary edges over 2% of edges | reject | `holes` |
| Non-manifold edges over 1% | reject | `non_manifold` |
| Mean vertex distance to the input over 2% of its longest side | reject | `drifted_from_input` |

Tiny disconnected fragments are removed first. A failing draw is retried with up to two more seeds. If none passes, the task fails with `error_kind: "quality"`.

The API starts a QuadriFlow `remesh` job next to every artist GLB job. The poll serves the artist mesh when it passes, and the QuadriFlow mesh when it fails, crashes, or is still not back after 6 minutes. The response carries `engines` so the UI can say which one was delivered.

## Contract

```
POST /retopo   {mesh: https url, target_faces?: 200..10000 (default 4000), output_format?: glb|obj|ply}  -> 202 {task_id}
GET  /tasks/{id}  -> {status, result_url, face_count, vertex_count, watertight, boundary_edge_ratio, fidelity, seed, attempts, textured}
GET  /health
```

Bearer auth with the shared worker secret. Input meshes are fetched through `worker_security.fetch_remote_bytes` (SSRF-guarded) and meshopt-decoded first.

The output carries the source's colour transferred per vertex (nearest surface point, sampled from its base-colour texture). It is not a UV-textured mesh; a baked texture would need a UV unwrap of the generated mesh.

## Files

- `lato_policy.py`: vertex budget, bbox frame, topology report, debris removal, gate. Pure numpy, unit tested.
- `lato_run.py`: seeded retry loop around a runner (the pinned upstream `scripts/e2e_inference.py` in production), colour transfer.
- `weights_sync.py`: copies checkpoints from `WEIGHTS_GCS_URI` into `LATO_ROOT/ckpt` at boot, prefetches DINOv2, then starts uvicorn.
- `main.py`: FastAPI task service.
- `worker_security.py`, `gltf_meshopt.py`, `test_gltf_meshopt.py`: vendored byte-identical (`npm run check:vendored`).

## Deploy

```bash
workers/model-lato2/stage_weights.sh                       # 3.6 GB into gs://three-ws-model-weights/lato2/
gcloud builds submit --config workers/model-lato2/cloudbuild.yaml --project aerial-vehicle-466722-p5 .
gcloud run services update three-ws-api --region us-central1 --update-env-vars MODEL_LATO2_URL=<service url>
```

Scale-to-zero. Tests (no GPU): `python -m pytest workers/model-lato2 -q`.

## Known limits

- `nvdiffrast` (NVIDIA Source Code License) is compiled in because upstream imports it through `o_voxel`. This is the same open licensing question as the TRELLIS.2 lanes (see [docs/research/forge-3d-adoption-2026-10-30.md](../../docs/research/forge-3d-adoption-2026-10-30.md)).
- Inference runs as a subprocess per attempt, so each attempt pays checkpoint load time. A resident-model server is the next optimisation once real traffic shows it matters.
