# TRELLIS.2 Lab

**Page:** [three.ws/lab/trellis2](https://three.ws/lab/trellis2) (`pages/lab-trellis2.html`, `src/lab-trellis2/`). Linked from the Forge header.

The lab runs Microsoft Research's open [TRELLIS.2](https://github.com/microsoft/TRELLIS.2) image-to-3D model (MIT) with every parameter we run it with exposed. You pick a photo, choose a preset or tune each sampler stage, and inspect the GLB it returns. You can also run a second engine on the same photo and compare the two side by side.

## What it does

| Area | Behaviour |
|---|---|
| Photo | Drag and drop, click to upload, or paste (PNG, JPEG or WebP, up to 8 MB, uploaded through `/api/forge-upload`). You can also pick one of the recent public community photos from `/api/forge-gallery`. |
| Presets | **Fast draft**, **Balanced** and **Maximum detail**. Each preset's speed label comes from the benchmark (below). If the benchmark has no run at that voxel resolution, the label says "Not measured yet" rather than showing an estimate. |
| Parameters | See the table below. Every field shows its default and a plain-language explanation. A field left at its default is not sent. |
| Run | `POST /api/forge` with `backend: "trellis2"`, then a poll of `GET /api/forge?job=`. The status is honest: submitting, queued for a GPU, then generating. It shows elapsed time and the engine's own estimate. Cancel stops watching the run; a GPU job that has already started still finishes on the server. Cmd or Ctrl+Enter also runs. |
| Viewer | Texture, wireframe and normal views. Stats are read from the parsed GLB: triangles, vertices, largest texture, number of maps and the real file size. Download saves the exact bytes that were inspected. |
| Timing | Wall time is measured in the browser. When the worker reports them, its queue time and GPU time are shown and stored on the creation (`queue_ms`, `gpu_ms`, `voxel_resolution` on `forge_creations`). |
| Compare | "Compare against" runs the same photo on any configured image lane, using that lane's defaults, in parallel. If the forge failed over to a different engine, the pane says which engine actually served the run. |
| Share | When the runs finish, the URL becomes `/lab/trellis2?a=<creation>&b=<creation>`. Opening that link reloads both models from `GET /api/forge-creation`, with their recorded end-to-end time, GPU time and voxel grid. |
| Offline | If the deployment has no TRELLIS.2 worker connected (`MODEL_TRELLIS2_URL` unset, or the health check reports `unconfigured`), Generate is disabled and the reason is shown. Shared links still load. |

## Parameters

| Parameter | Values | Default | Sent as |
|---|---|---|---|
| Voxel resolution | 512, 1024, 1536 | 1024 | `resolution` (512 runs on the `draft` tier, 1024 and 1536 on `standard`) |
| Seed | 0 to 4294967295 | 42 | `seed` |
| Texture size | 512, 1024, 2048, 4096 px | resolution preset (2048 at 512, otherwise 4096) | `texture_size` |
| Face budget | 50,000 to 500,000 | resolution preset (300k, 1M, 1.5M) | `target_polycount` |
| Sparse structure steps / guidance | 1 to 50 / 0 to 15 | 12 / 7.5 | `sampler.sparse_structure` |
| Shape detail steps / guidance | 1 to 50 / 0 to 15 | 12 / 7.5 | `sampler.shape_slat` |
| Texture and material steps / guidance | 1 to 50 / 0 to 15 | 12 / 1.0 | `sampler.tex_slat` |

The sampler defaults are upstream's `pipeline.json` values. The API validates `sampler` in `api/_lib/forge-options.js` (only `steps` and `guidance_strength` per stage; anything else returns 422). The worker applies them in `workers/model-trellis2/request_policy.py`. The request builder (`src/lab-trellis2/params.js`) is unit tested against that same validator in `tests/lab-trellis2-params.test.js`.

The API caps `target_polycount` at 500,000. The 1M and 1.5M face budgets at 1024 and 1536 therefore apply only when the face budget is left at its default.

## Benchmark

`scripts/trellis2-benchmark.mjs` reads real `forge_creations` rows from the production database with one read-only SELECT. It writes `data/trellis2-benchmark.json`, which the lab imports for its preset labels and its "Measured on production" table.

```bash
npm run trellis2:benchmark                 # trailing 30 days, writes data/trellis2-benchmark.json
npm run trellis2:benchmark -- --days 7     # another window
npm run trellis2:benchmark -- --stdout     # print only
```

It reads `DATABASE_URL` from the environment, then `.env.local`, then `.env`. Per lane, and per tier and voxel resolution within each lane, it reports:

- **End to end:** `completed_at - created_at` on done rows, as nearest-rank p50 / p90 / p99. Every number is a real sample.
- **Queue and GPU time:** `queue_ms` and `gpu_ms` as measured by the serving worker. Only the TRELLIS.2 worker reports these. Any group with no recorded value says `"not measured"`.
- **Failure rate:** failed / (done + failed). Rows still generating are excluded.
- **Output size:** `size_bytes` of done rows.

The presets map to voxel resolutions (fast draft 512, balanced 1024, maximum detail 1536) and read the `trellis2` lane grouped by `voxel_resolution`. After new lab runs, rerun the script and commit the JSON so the labels track production. Tests: `tests/trellis2-benchmark.test.js`.

A job the worker loses mid-run (an out-of-memory kill) never reports its resolution, so it cannot be keyed to one preset. Each preset also carries `tier`, `tier_rows` and `tier_failed` for the tier it runs on (512 is `draft`, 1024 and 1536 are `standard`). A preset with failures on its tier and no finished run at its resolution reads "Failing on production", with the count on the card.

## How we run it

| | |
|---|---|
| GPU | NVIDIA L4 (24 GB), one per instance |
| Platform | Google Cloud Run with GPU, us-central1, 0 to 2 instances |
| Container | CUDA 12.4, Ubuntu 22.04, Python 3.10, PyTorch with O-Voxel, FlexGEMM, CuMesh and nvdiffrast compiled in (`workers/model-trellis2/Dockerfile`) |
| Upstream | `microsoft/TRELLIS.2` pinned at commit `75fbf0183001ed9876c8dbb35de6b68552ee08bd` |

Wiring the lab into production takes two owner-gated steps:

1. Deploy the worker with `workers/model-trellis2/cloudbuild.yaml`.
2. Set `MODEL_TRELLIS2_URL` on `three-ws-api`.

The worker README has both commands.

### Measured status (2026-11-11)

These runs went from the lab on a local dev server against a scale-to-zero copy of the worker (`model-trellis2-lab`, europe-west1, image `server:fix11111641`). us-central1 had no free L4 for a new revision.

| Preset | Result |
|---|---|
| Fast draft (512) | Works. 2 of 2 finished: 56 s end to end, GPU 48 to 50 s, about 290k triangles, 2048 px texture with 5 maps, 3.6 to 3.7 MB. |
| Balanced (1024) | All three sampling stages finish. The container is then killed with signal 9 during decode and GLB bake: host RAM, the 32 GiB Cloud Run ceiling. The instance holds 16.9 GiB right after load. |
| Maximum detail (1536) | Failed the same way ("ran out of resources"). |

The worker's step-down only catches CUDA out-of-memory, so a host-RAM kill fails the job outright. The fix belongs in `workers/model-trellis2`: either lower the resident host footprint (the models are held on the CPU between stages under `low_vram`) or bound the postprocess memory. Until then, use Fast draft for real runs.

## Credit

TRELLIS.2 is by Microsoft Research and released under the MIT license. The lab page carries the citation, a license link, the repository link and the run details above.

```bibtex
@article{
    xiang2025trellis2,
    title={Native and Compact Structured Latents for 3D Generation},
    author={Xiang, Jianfeng and Chen, Xiaoxue and Xu, Sicheng and Wang, Ruicheng and Lv, Zelong and Deng, Yu and Zhu, Hongyuan and Dong, Yue and Zhao, Hao and Yuan, Nicholas Jing and Yang, Jiaolong},
    journal={Tech report},
    year={2025}
}
```

Microsoft and TRELLIS are trademarks of the Microsoft group of companies.
