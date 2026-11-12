# Forge 3D quality: what to adopt next (2026-10-30)

Follow-up to [3d-landscape-2026-10.md](3d-landscape-2026-10.md). Licenses were read from the LICENSE files and Hugging Face cards on 2026-10-30, not from blog posts.

## Finding 1: the biggest quality gap is a deploy, not a new model

The repo already contains workers for TRELLIS.2, Pixal3D, PartCrafter, HoloPart, AniGen and SAM 3D Objects. In production only TRELLIS v1 serves image-to-3D: `/api/forge-quote` reports `trellis_selfhost`, and `gcloud run services list` shows no `model-trellis2` or `model-pixal3d`. `api/_lib/forge-tiers.js` routes every tier to `trellis2` first and skips it while `MODEL_TRELLIS2_URL` is unset, so every job silently falls back to v1.

Status on 2026-10-30:
- `model-trellis2`: Artifact Registry repo created, weights already staged at `gs://three-ws-model-weights/trellis2-4b/`, Cloud Build submitted (build `68a20930-157f-43ca-a298-aad01f4aa35f`, `three-ws-build@`, scale-to-zero). After it succeeds: smoke-test the service directly, then set `MODEL_TRELLIS2_URL` with `--update-env-vars`.
- `model-pixal3d`: no staged weights yet (not under `gs://three-ws-model-weights/`). Stage after TRELLIS.2 is verified.

## Finding 2: candidates that are new since the October 9 sweep

| Project | License (verified) | Fit | Verdict |
|---|---|---|---|
| [LoHhhha/LATO.2](https://github.com/LoHhhha/LATO.2) (Meshy, Jul 2026) | MIT code, MIT weights | Mesh in, artist-style low-poly mesh out. 200 to 5000 vertices, about 8 GB VRAM, about 5 s on an H800. Upstream warns outputs can contain holes. | **Adopt** as an "Artist mesh" retopology lane beside QuadriFlow, gated by a watertight check with QuadriFlow as the fallback. This is the first permissive open model that closes the retopology gap named in the October sweep. |
| [yiboz2001/UltraTex](https://github.com/yiboz2001/UltraTex) (SIGGRAPH Asia 2026) | MIT code; weights on ModelScope, license to be read before use | 2048 px multi-view diffusion texturing. Our `workers/texture` is SDXL plus ControlNet-Depth back-projection. | **Adopt** as the texture lane successor after reading the weights license. Triton kernels, Python 3.12, PyTorch 2.5.1. |
| [Stability-AI/arbor](https://github.com/Stability-AI/arbor) | MIT code; HF weights card says "other" | Text to 3D under hull, avoidance and touch constraint meshes, TRELLIS decoder. | **Evaluate** after TRELLIS.2 is live. Read the weights license first. Fits "fit inside this volume" and print-bbox use cases. |
| [PKU-YuanGroup/UltraShape-1.0](https://github.com/PKU-YuanGroup/UltraShape-1.0) | Repo LICENSE is the Tencent Hunyuan 3D 2.1 license (excludes EU, UK, South Korea); weights card says Apache-2.0 | Geometry refinement on a coarse mesh. | **Reject for now.** The code license carries the territory exclusion we already gate around. |
| [DerKleineLi/triflow](https://github.com/DerKleineLi/triflow) | Automotive Development Public Non-Commercial License | Artist-like topology. | **Reject.** Non-commercial. |
| [Xrvitd/MeshMosaic](https://github.com/Xrvitd/MeshMosaic), [Xrvitd/SATO](https://github.com/Xrvitd/SATO) | AGPL-3.0, GPL-3.0 | Artist-style meshes. | **Reject.** Copyleft in a hosted service. |
| [Roblox/cube](https://github.com/Roblox/cube) (CubePart) | NOASSERTION | Part-controllable generation. | **Reference only** until the LICENSE is read. |

## Finding 3: what to do with each

1. Finish the TRELLIS.2 deploy and flip the lane (in progress). Then Pixal3D on about 50 real inputs, promote the winner (the plan from `docs/ops/image-selfie-3d-review-2026-10-09.md`).
2. Build `workers/model-lato2`: FastAPI `/infer` taking a mesh URL and a vertex budget, validating the output is watertight, returning a GLB. Wire it as the `retopo` mode in `api/forge-gameready.js` and the pipeline remesh stage with QuadriFlow as the failover rung.
3. Build the UltraTex texture rung in `workers/texture` once the weights license is confirmed.
4. Open question that decides the roadmap: nvdiffrast (NVIDIA Source Code License) sits under both TRELLIS lanes. Replacing the bake rasteriser removes the only commercial-use risk in the default lane.

## Addendum (2026-11-12): nvdiffrast licence and the replacement bake rasteriser

Closes the open question in Finding 3, item 4. Measured and built by work order 757.

**Licence, read from the source.** NVlabs/nvdiffrast `LICENSE.txt` (the v0.4.0 tag the Forge Dockerfiles clone, and current main) is the "Nvidia Source Code License (1-Way Commercial)". Section 3.3 limits use of the Work and derivative works to "research or evaluation purposes only and not for any direct or indirect monetary gain", and reserves commercial use to NVIDIA and its affiliates. The paid Forge lanes are monetary gain, so the restriction applies. Because it covers derivative works too, the replacement was written from the standard homogeneous rasterisation maths, with no nvdiffrast code copied or ported.

**Where it sits.** `o_voxel.postprocess.to_glb` (TRELLIS.2 commit 75fbf018) imports `nvdiffrast.torch` at module load and uses only `RasterizeCudaContext`, `rasterize` (UV space, 100k-face chunks) and `interpolate`. Images that build it: `model-trellis2`, `model-trellis`, `model-pixal3d`, `model-lato2`. `model-anigen` already patches it out at build time.

**What shipped.** `workers/model-trellis2/bake_raster.py`, vendored byte-identical (with its suite) into the other three workers and enforced by `npm run check:vendored`. It exposes the nvdiffrast surface the bake uses, so upstream code runs unchanged, and has two backends chosen by `BAKE_RASTER_BACKEND`: `nvdiffrast` (default, unchanged) and `torch`, a pure-PyTorch rasteriser (BSD-3 dependency only, CPU or CUDA, no compiled extension). With `torch` on an image without nvdiffrast, `nvdiffrast.torch` is registered as a shim so `o_voxel` still imports. `model-trellis2` installs the selected backend before the pipeline import. The order suggested pytorch3d, kaolin or moderngl. A self-contained torch rasteriser was chosen instead because it needs no second CUDA extension build, which was the other half of the problem, and it matches nvdiffrast's output layout exactly.

**Benchmark.** 10 real TRELLIS.2 outputs from `gs://three-ws-avatar-reconstructions/raw-meshes/trellis2/` (289k to 988k faces, decoded with `scripts/forge/decode-glb-mesh.mjs`), replaying the exact `to_glb` UV bake loop with `workers/model-trellis2/bench_bake_raster.py` at the production texture size of 2048. GPU columns: NVIDIA L4, Cloud Run job `bake-bench-757` (us-east4), image built from `model-trellis2/server:fix11111641` (torch 2.6.0+cu124, nvdiffrast v0.4.0). CPU column: the shared dev host, 4 threads, heavily loaded. Coverage is covered texels divided by the analytic UV area of the layout. Surface point delta is the distance between the two backends' interpolated 3D points per texel, over every texel both cover, in model units (meshes span about 1.0). Texel-centre error is how far interpolating the UVs lands from the texel centre: it should be 0.

| Mesh | Faces | nvdiffrast GPU s | torch GPU s | torch CPU s | Coverage nvdiffrast / torch | Same face | One-sided coverage | Surface point delta p99 / max | Texel-centre error nvdiffrast / torch (texels) |
|---|---:|---:|---:|---:|---|---:|---:|---|---|
| `0983e279` | 980,708 | 0.030 | 0.092 | 14.02 | 99.89% / 99.88% | 97.42% | 0.51% | 2.6e-05 / 0.0061 | 2.15 / 0.00024 |
| `121d3a48` | 986,884 | 0.030 | 0.092 | 12.55 | 99.84% / 99.83% | 97.45% | 0.77% | 1.6e-05 / 0.0125 | 0.91 / 0.00024 |
| `262407b2` | 296,896 | 0.011 | 0.056 | 3.27 | 99.95% / 99.95% | 98.52% | 0.41% | 1.7e-06 / 0.0036 | 0.37 / 0.00024 |
| `36c064f4` | 977,662 | 0.029 | 0.115 | 5.42 | 100.01% / 100.01% | 98.16% | 0.00% | 8.0e-06 / 0.0003 | 0.35 / 0.00024 |
| `3c61996d` | 289,824 | 0.011 | 0.060 | 2.51 | 99.97% / 99.97% | 98.63% | 0.35% | 3.6e-07 / 0.0021 | 0.47 / 0.00024 |
| `3f4550e9` | 977,662 | 0.029 | 0.091 | 4.74 | 99.93% / 99.92% | 97.35% | 0.49% | 2.1e-05 / 0.0299 | 0.70 / 0.00024 |
| `49e23212` | 937,295 | 0.029 | 0.099 | 4.14 | 99.95% / 99.95% | 97.67% | 0.56% | 2.3e-05 / 0.0227 | 1.41 / 0.00024 |
| `594eba3c` | 988,455 | 0.029 | 0.093 | 4.94 | 99.97% / 99.97% | 97.53% | 0.49% | 1.2e-05 / 0.0119 | 1.53 / 0.00024 |
| `6a360392` | 978,624 | 0.031 | 0.091 | 4.68 | 99.75% / 99.74% | 97.20% | 0.93% | 2.8e-05 / 0.0058 | 0.55 / 0.00024 |
| `794b2630` | 964,858 | 0.029 | 0.094 | 4.61 | 99.95% / 99.96% | 97.60% | 0.43% | 1.3e-05 / 0.0018 | 1.48 / 0.00024 |
| **Total / worst** | | **0.26** | **0.885** | **60.9** | min 99.75% / 99.74% | min 97.20% | max 0.93% | max 2.8e-05 / 0.0299 | max 2.15 / 0.00024 |

At 1024: nvdiffrast 0.088 s and torch 0.46 s for all 10, minimum same-face share 94.8%, one-sided coverage at most 1.8%, surface point delta p99 at most 9.5e-05.

**Reading it.**

- **Quality: equal, and slightly better in one respect.** Coverage matches to within 0.02 points on every mesh. The texels where the two disagree are edge texels. A GPU diagnostic on two of the meshes and a unit sphere found every disagreement within 0.044 px of a triangle edge (p99 0.039 px), because nvdiffrast snaps vertices to a fixed-point subpixel grid. nvdiffrast's pick sometimes has the texel centre just outside its triangle, while the torch backend's pick always contains it, which is why its UV reprojection error is about 1/4000 of a texel against nvdiffrast's up to 2. The few larger surface point deltas (max 0.03) are texels where UV islands overlap at equal depth, where either face is a valid choice. The parity test (`test_torch_backend_matches_nvdiffrast_on_a_unit_mesh`) asserts exactly this contract and passes on the L4.
- **Speed: the rasterise step is 3.4x slower at 2048 (5.2x at 1024), so the default stays `nvdiffrast`.** In absolute terms it costs about 63 ms more per job. A 512 job is about 50 s of GPU time end to end (README, 2026-11-11), so the whole-job difference is about 0.1%. The order's rule was to flip the default only if speed is within 5%. Measured on the bake step alone it is not, so the flip was not made.

**Migration path.**

1. Now: `BAKE_RASTER_BACKEND=nvdiffrast` (the default) changes nothing. Setting `BAKE_RASTER_BACKEND=torch` on `model-trellis2` is a config-only change that removes nvdiffrast from the bake path. It can be rolled back the same way.
2. Once the torch backend has run in production: drop the nvdiffrast build from the `model-trellis2` Dockerfile (the shim keeps `o_voxel` importable), which also removes a fragile CUDA extension compile.
3. Repeat for `model-lato2` and `model-pixal3d`, which also bake through `o_voxel`, and `model-trellis` (v1, whose renderers import nvdiffrast lazily). Their copies of `bake_raster.py` are already vendored and tested.
4. To re-measure: `node scripts/forge/decode-glb-mesh.mjs <dir> <mesh.glb>...`, then `python bench_bake_raster.py --raw-dir <dir> --backend both` on any GPU with the worker image.
